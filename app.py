import os
import json
import smtplib
import threading
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, render_template, send_from_directory
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__, static_folder="static", template_folder="templates")

DATA_FILE = "emergencyData.json"

# Initialize data
if os.path.exists(DATA_FILE):
    with open(DATA_FILE, "r") as f:
        try:
            data = json.load(f)
        except:
            data = {"emergencies": {}, "reliefCamps": []}
else:
    data = {"emergencies": {}, "reliefCamps": []}


def save_data():
    with open(DATA_FILE, "w") as f:
        json.dump(data, f)


# -------------------------------
# Background cleanup task
# -------------------------------
def cleanup_task():
    while True:
        now = datetime.utcnow()
        expired = []
        for deviceId, info in list(data["emergencies"].items()):
            emergency_time = datetime.fromisoformat(info["timestamp"])
            if (now - emergency_time) > timedelta(minutes=5):
                expired.append(deviceId)
        for d in expired:
            del data["emergencies"][d]
        if expired:
            save_data()
        # run every 60 sec
        threading.Event().wait(60)


threading.Thread(target=cleanup_task, daemon=True).start()

# -------------------------------
# FRONTEND ROUTES
# -------------------------------
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/admin")
def admin():
    return render_template("admin.html")

@app.route("/about")
def about():
    return render_template("about.html")

@app.route("/home")
def home():
    return render_template("home.html")

@app.route("/demo")
def demo():
    return render_template("demo.html")


# -------------------------------
# API ROUTES
# -------------------------------
@app.route("/update", methods=["POST"])
def update():
    body = request.json
    deviceId = body.get("deviceId")
    status = body.get("status")

    if not deviceId:
        return jsonify({"error": "deviceId required"}), 400

    if status == "CLEAR":
        data["emergencies"].pop(deviceId, None)
    else:
        data["emergencies"][deviceId] = {
            **body,
            "timestamp": datetime.utcnow().isoformat()
        }
    save_data()
    return jsonify({"success": True})


@app.route("/getActiveSOS", methods=["GET"])
def get_active_sos():
    return jsonify(list(data["emergencies"].values()))


@app.route("/removeSOS", methods=["POST"])
def remove_sos():
    body = request.json
    deviceId = body.get("deviceId")
    if deviceId in data["emergencies"]:
        del data["emergencies"][deviceId]
        save_data()
    return jsonify({"success": True})


@app.route("/getReliefCamps", methods=["GET"])
def get_relief_camps():
    return jsonify(data["reliefCamps"])


@app.route("/addReliefCamp", methods=["POST"])
def add_relief_camp():
    body = request.json
    lat, lng, name = body.get("lat"), body.get("lng"), body.get("name")
    if not lat or not lng:
        return jsonify({"error": "Coordinates are required"}), 400

    data["reliefCamps"].append({
        "lat": float(lat),
        "lng": float(lng),
        "name": name or "Emergency Shelter"
    })
    save_data()
    return jsonify({"success": True})


@app.route("/removeReliefCamp", methods=["POST"])
def remove_relief_camp():
    body = request.json
    index = body.get("index")
    if index is not None and 0 <= index < len(data["reliefCamps"]):
        data["reliefCamps"].pop(index)
        save_data()
        return jsonify({"success": True})
    return jsonify({"error": "Invalid camp index"}), 400


@app.route("/forceUpdate", methods=["GET"])
def force_update():
    return jsonify({"success": True, "emergencies": list(data["emergencies"].values())})


@app.route("/updateAdminMap", methods=["POST"])
def update_admin_map():
    pins = request.json
    for pin in pins:
        data["emergencies"][pin["deviceId"]] = {
            **pin,
            "timestamp": datetime.utcnow().isoformat()
        }
    save_data()
    return jsonify({"success": True})


@app.route("/sendEmails", methods=["POST"])
def send_emails():
    body = request.json
    emails = body.get("emails", [])
    message = body.get("message", "")
    deviceId = body.get("deviceId")

    if not emails or not isinstance(emails, list):
        return jsonify({"error": "Emails array is required"}), 400
    if not message:
        return jsonify({"error": "Message is required"}), 400

    userInfo = data["emergencies"].get(deviceId, {})

    trackingUrl = f"http://127.0.0.1:3000/admin?id={deviceId}"
    htmlContent = f"""
    <div style="font-family: 'Google Sans', system-ui; background: #0e0e0e; color: #f3f3f3 !important; padding: 24px; border-radius: 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); max-width: 600px; margin: auto;">
      <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 16px;">
        <img src='https://i.ibb.co/HfWzC5D8/logo.png' alt='<SafeResQ>' onerror="this.style.display" style='height: 48px; margin-right: 12px;'>
        <span style="font-family: 'Google Sans', system-ui; font-size: 2rem; color: #00ff93; font-weight: bold;">SafeResQ</span>
      </div>
      <h2 style="text-align: center; color: #00ff93; font-family: 'Google Sans', system-ui;">🚨 Emergency Alert</h2>
      <div style="background: #181818; border-radius: 10px; padding: 18px; margin: 18px 0;">
        <p style="font-size: 1.1rem; margin-bottom: 10px; color: #ff2929; background: transparent; font-weight: 1000; padding: 10px; border-radius: 10px;">{message}</p>
        <ul style="list-style: none; padding: 0; margin: 0;">
          <li><b>Name:</b> {userInfo.get('name','Unknown')}</li>
          <li><b>Age:</b> {userInfo.get('age','Unknown')}</li>
          <li><b>Gender:</b> {userInfo.get('gender','Unknown')}</li>
          <li><b>Device ID:</b> {deviceId}</li>
          <li><b>Location:</b> {userInfo.get('lat')}, {userInfo.get('lon')}</li>
          <li><b>Accuracy:</b> {userInfo.get('accuracy','Unknown')} m</li>
          <li><b>Timestamp:</b> {userInfo.get('timestamp', 'Unknown')}</li>
        </ul>
        <style>
          .im {{
            color: white !important;
          }}
        </style>
      </div>
      <div style="background: #181818; color: #fff; padding: 15px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); margin-top: 20px; text-align: center;">
        <p style="margin: 0; font-weight: bold;">Track the user's location here:</p>
        <a href="{trackingUrl}" style="color: #00ff93; font-weight: bold; font-size: 1.1rem;">Click to Track Location</a>
      </div>
      <p style="text-align: center; margin-top: 24px; color: #bbb;">Automated emergency alert from SafeResQ.<br>Stay safe!</p>
    </div>
    """

    try:
        sender = os.getenv("GMAIL_APP_EMAIL")
        password = os.getenv("GMAIL_APP_PASSWORD")

        msg = MIMEMultipart("alternative")
        msg["Subject"] = "Emergency Alert"
        msg["From"] = sender
        msg["To"] = ",".join(emails)
        msg.attach(MIMEText(htmlContent, "html"))

        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(sender, password)
            server.sendmail(sender, emails, msg.as_string())

        return jsonify({"success": True, "sent": len(emails)})

    except Exception as e:
        print("Error sending emails:", e)
        return jsonify({"error": "Failed to send emails"}), 500


if __name__ == "__main__":
    app.run(debug=True, port=3000)
