// DOM Elements
const form = document.getElementById('userForm');
const nameInput = document.getElementById('name');
const genderInput = document.getElementById('gender');
const ageInput = document.getElementById('age');
const sosButton = document.getElementById('sosButton');
const gpsStatus = document.getElementById('gpsStatus');
const mapContainer = document.getElementById('mapContainer');
const userMap = document.getElementById('userMap');
const mapInstructions = document.getElementById('mapInstructions');
const removeMarkerButton = document.getElementById('removeMarkerButton');

// App State
let emergencyActive = localStorage.getItem('emergencyActive') === 'true';
let locationInterval;
let holdTimer;
let manualMarker = null;
let accuracyCircle = null;
let nearbyMarkers = [];
let reliefCampMarkers = [];
let manualMarkerPosition = JSON.parse(localStorage.getItem('manualMarkerPosition')) || null;
let userPosition = null;
let initialCenteringDone = false;
const deviceId = localStorage.getItem('deviceId') || crypto.randomUUID();
localStorage.setItem('deviceId', deviceId);

// Custom icons
const maleManualIcon = L.icon({
  iconUrl: 'https://cdn2.iconfinder.com/data/icons/ultimate-business-icons/64/1-08-512.png',
  iconSize: [32, 32],
  iconAnchor: [16, 32]
});

const femaleManualIcon = L.icon({
  iconUrl: '   https://cdn-icons-png.flaticon.com/512/12117/12117624.png',
  iconSize: [32, 32],
  iconAnchor: [16, 32]
});

const emergencyIcon = L.icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/484/484167.png',
  iconSize: [24, 24],
  iconAnchor: [12, 24]
});

const campIcon = L.icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/4850/4850336.png',
  iconSize: [28, 28],
  iconAnchor: [14, 28]
});

// Initialize user map
const map = L.map('userMap').setView([20.0, 77.0], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Load saved user info
const savedInfo = JSON.parse(localStorage.getItem('userInfo')) || {};
nameInput.value = savedInfo.name || '';
genderInput.value = savedInfo.gender || '';
ageInput.value = savedInfo.age || '';

// Initialize SOS state if active
if (emergencyActive) {
  activateSOS();
}

// Event Listeners
form.addEventListener('submit', handleFormSubmit);
sosButton.addEventListener('mousedown', startHoldTimer);
sosButton.addEventListener('mouseup', clearHoldTimer);
sosButton.addEventListener('mouseleave', clearHoldTimer);
sosButton.addEventListener('touchstart', handleTouchStart);
sosButton.addEventListener('touchend', handleTouchEnd);
window.addEventListener('beforeunload', handleBeforeUnload);
removeMarkerButton.addEventListener('click', () => {
  clearManualMarker();
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const coords = position.coords;
      updateUserMap(coords);

      // Send updated location to the server
      const locationData = {
        deviceId,
        status: emergencyActive ? 'SOS' : 'CLEAR',
        lat: coords.latitude,
        lon: coords.longitude,
        accuracy: Math.round(coords.accuracy),
        isManual: false,
        timestamp: new Date().toISOString()
      };
      updateEmergency(locationData);
    },
    (error) => {
      console.error('Location error:', error);
      gpsStatus.textContent = 'Location access denied - Please place marker manually';
      gpsStatus.style.color = 'red';
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

// Initialize
loadNearbyEmergencies();
loadReliefCamps();

// Auto-refresh every 3 seconds
const refreshInterval = setInterval(() => {
  if (emergencyActive) sendLocation('SOS');
  loadNearbyEmergencies();
  loadReliefCamps();
}, 3000);

// Main Functions
function handleFormSubmit(e) {
  e.preventDefault();
  const userInfo = {
    name: nameInput.value.trim(),
    gender: genderInput.value,
    age: ageInput.value
  };
  localStorage.setItem('userInfo', JSON.stringify(userInfo));
  
  if (emergencyActive) {
    sendLocation('UPDATE');
  }
  alert('Profile saved successfully!');
}

function startHoldTimer() {
  holdTimer = setTimeout(emergencyActive ? deactivateSOS : activateSOS, 1500);
}

function clearHoldTimer() {
  clearTimeout(holdTimer);
}

function handleTouchStart(e) {
  e.preventDefault();
  startHoldTimer();
}

function handleTouchEnd(e) {
  e.preventDefault();
  clearHoldTimer();
}

function handleBeforeUnload() {
  if (!emergencyActive) {
    fetch('/removeSOS', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId })
    }).catch(console.error);
  }
}

// SOS Functions
function activateSOS() {
  emergencyActive = true;
  localStorage.setItem('emergencyActive', 'true');
  sosButton.classList.replace('green', 'red');
  sosButton.textContent = 'SOS ACTIVE - HOLD TO STOP';
  
  // Send initial SOS immediately
  sendLocation('SOS');
  
  if (manualMarkerPosition) {
    createManualMarker(manualMarkerPosition);
  }
}

function deactivateSOS() {
  if (!emergencyActive) return;
  
  emergencyActive = false;
  localStorage.setItem('emergencyActive', 'false');
  sosButton.classList.replace('red', 'green');
  sosButton.textContent = 'HOLD TO SEND SOS';
  sendLocation('CLEAR');
  
  clearManualMarker();
  localStorage.removeItem('manualMarkerPosition');
  manualMarkerPosition = null;
}

// Location Functions
function sendLocation(status) {
  const userInfo = JSON.parse(localStorage.getItem('userInfo')) || {};
  
  const locationData = {
    deviceId,
    status,
    ...userInfo,
    timestamp: new Date().toISOString()
  };

  if (manualMarker) {
    const coords = manualMarker.getLatLng();
    locationData.lat = coords.lat;
    locationData.lon = coords.lng;
    locationData.accuracy = 0;
    locationData.isManual = true;
    updateEmergency(locationData);
  } else {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        locationData.lat = position.coords.latitude;
        locationData.lon = position.coords.longitude;
        locationData.accuracy = Math.round(position.coords.accuracy);
        locationData.isManual = false;
        updateEmergency(locationData);
        updateUserMap(position.coords);
      },
      (error) => {
        console.error('Location error:', error);
        gpsStatus.textContent = 'Location access denied - Please place marker manually';
        gpsStatus.style.color = 'red';
        mapContainer.style.display = 'block';
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }
}

function updateEmergency(data) {
  fetch('/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).then(response => {
    if (!response.ok) throw new Error('Network response was not ok');
    const accuracyText = data.accuracy ? ` (Accuracy: ${data.accuracy}m)` : '';
    gpsStatus.textContent = `Location sent${accuracyText}`;
    gpsStatus.style.color = data.accuracy > 30 ? 'orange' : 'green';
    
    // Force update admin map immediately
    if (data.status === 'SOS') {
      fetch('/forceUpdate');
      // Send auto email only after location is saved
      const autoEmail = localStorage.getItem('autoEmail') === 'true';
      if (autoEmail) {
        const emails = JSON.parse(localStorage.getItem('emergencyEmails')) || [];
        const message = localStorage.getItem('emergencyMessage') || '';
        const deviceId = localStorage.getItem('deviceId');
        if (emails.length > 0 && message) {
          fetch('/sendEmails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emails, message, deviceId })
          })
            .then(response => {
              if (!response.ok) throw new Error('Failed to send emails');
              // console.log('Emails sent successfully!');
            })
            .catch(error => {
              console.error('Error sending emails:', error);
            });
        }
      }
    }
  }).catch(error => {
    console.error('Error:', error);
    gpsStatus.textContent = 'Failed to send location';
    gpsStatus.style.color = 'red';
  });
}

// Map Functions
function updateUserMap(coords) {
  if (!initialCenteringDone) {
    map.setView([coords.latitude, coords.longitude], 15);
    initialCenteringDone = true;
  }
  
  updateAccuracyCircle([coords.latitude, coords.longitude], coords.accuracy);
  
  if (manualMarker && coords.accuracy <= 30) {
    clearManualMarker();
    localStorage.removeItem('manualMarkerPosition');
    manualMarkerPosition = null;
  }
  
  map.off('click').on('click', (e) => {
    manualMarkerPosition = e.latlng;
    localStorage.setItem('manualMarkerPosition', JSON.stringify(manualMarkerPosition));
    createManualMarker(e.latlng);
    
    if (emergencyActive) {
      sendLocation('SOS');
    }
  });
}

function createManualMarker(latlng) {
  clearManualMarker();
  const gender = genderInput.value;
  const icon = gender === 'female' ? femaleManualIcon : maleManualIcon;
  manualMarker = L.marker(latlng, { icon }).addTo(map);
  updateRemoveMarkerButton();
}

function clearManualMarker() {
  if (manualMarker) {
    map.removeLayer(manualMarker);
    manualMarker = null;
  }
  updateRemoveMarkerButton();
}

let accuracyCenterMarker = null;

function updateAccuracyCircle(center, radius) {
  clearAccuracyCircle();
  if (radius > 0) {
    accuracyCircle = L.circle(center, {
      radius: radius,
      color: 'blue',
      fillOpacity: 0.2
    }).addTo(map);

    // Add or update the cross icon at the center of the accuracy circle
    if (!manualMarker) {
      if (accuracyCenterMarker) {
        accuracyCenterMarker.setLatLng(center);
      } else {
        accuracyCenterMarker = L.marker(center, {
          icon: L.icon({
            iconUrl: 'https://cdn-icons-png.flaticon.com/512/6602/6602786.png', // Flaticon crosshair image
            iconSize: [32, 32], // Size of the icon
            iconAnchor: [16, 16] // Center the icon perfectly
          })
        }).addTo(map);
      }
    }
  }
}

function clearAccuracyCircle() {
  if (accuracyCircle) {
    map.removeLayer(accuracyCircle);
    accuracyCircle = null;
  }
  if (accuracyCenterMarker) {
    map.removeLayer(accuracyCenterMarker);
    accuracyCenterMarker = null;
  }
}

function loadNearbyEmergencies() {
  fetch('/getActiveSOS?t=' + Date.now())
    .then(response => response.json())
    .then(emergencies => {
      clearNearbyMarkers();
      emergencies.forEach(emergency => {
        if (emergency.deviceId !== deviceId) {
          const marker = L.marker([emergency.lat, emergency.lon], {
            icon: emergencyIcon
          }).bindTooltip(`Emergency: ${emergency.name || 'Unknown'}`, {
            permanent: false,
            direction: 'top'
          }).addTo(map);
          nearbyMarkers.push(marker);
        }
      });
    })
    .catch(error => console.error('Error loading emergencies:', error));
}

function loadReliefCamps() {
  fetch('/getReliefCamps?t=' + Date.now())
    .then(response => response.json())
    .then(camps => {
      clearReliefCampMarkers();
      camps.forEach(camp => {
        const marker = L.marker([camp.lat, camp.lng], {
          icon: campIcon
        }).bindTooltip(`Relief Camp: ${camp.name || 'Emergency Shelter'}`, {
          permanent: false,
          direction: 'top'
        }).addTo(map);
        reliefCampMarkers.push(marker);
      });
    })
    .catch(error => console.error('Error loading camps:', error));
}

function clearNearbyMarkers() {
  nearbyMarkers.forEach(marker => map.removeLayer(marker));
  nearbyMarkers = [];
}

function clearReliefCampMarkers() {
  reliefCampMarkers.forEach(marker => map.removeLayer(marker));
  reliefCampMarkers = [];
}

// Initial checks
if (!navigator.geolocation) {
  gpsStatus.textContent = 'Geolocation not supported - Please place marker manually';
  sosButton.disabled = true;
  mapContainer.style.display = 'block';
}

// Show or hide the remove marker button based on manual marker state
function updateRemoveMarkerButton() {
  if (manualMarker) {
    removeMarkerButton.style.opacity = '1';
    removeMarkerButton.style.pointerEvents = 'auto';
  } else {
    removeMarkerButton.style.opacity = '0';
    removeMarkerButton.style.pointerEvents = 'none';
  }
}

// Call updateRemoveMarkerButton initially to set the correct state
updateRemoveMarkerButton();

// Add email overlay functionality
const emailOverlay = document.createElement('div');
emailOverlay.id = 'emailOverlay';
emailOverlay.style.position = 'fixed';
emailOverlay.style.top = '0';
emailOverlay.style.left = '0';
emailOverlay.style.width = '100%';
emailOverlay.style.height = '100%';
emailOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
emailOverlay.style.display = 'none';
emailOverlay.style.zIndex = '1000';
emailOverlay.style.color = 'white';
emailOverlay.style.overflowY = 'auto';
emailOverlay.innerHTML = `
  <div style="padding: 20px; max-width: 500px; margin: 50px auto; background: #121212; border-radius: 10px;">
    <h2>Emergency Email Setup</h2>
    <textarea id="emergencyMessage" placeholder="Enter emergency message" style="width: calc(100% - 20px); margin-bottom: 10px; height: 80px; background: #333; color: red; font-size: 18px; font-weight: bold; border: none; outline: none; padding: 10px; border-radius: 10px"></textarea>
    <div id="emailList"></div>
    <button id="addEmailButton" style="margin-bottom: 10px;">Add Email</button>
    <label style="display: flex; flex-direction: row; justify-content: center; align-items: center;">
      <txt>Send emails automatically on SOS activation</txt>
      <input type="checkbox" id="autoEmailCheckbox" style="width: 50px; scale: 1.5;">
    </label>
    <br>
    <button id="saveEmailSettings">Save</button>
    <button id="closeEmailOverlay">Back</button>
    <button id="sendEmailsNow">Send Emails Now</button>
  </div>
`;
document.body.appendChild(emailOverlay);

const emailButton = document.createElement('button');
emailButton.textContent = 'Email Setup';
emailButton.style.margin = '10px';
emailButton.addEventListener('click', () => {
  emailOverlay.style.display = 'block';
  loadEmailSettings();
});
document.body.appendChild(emailButton);

// Move emailButton after save profile
window.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('userForm');
  if (form && emailButton) {
    form.parentNode.insertBefore(emailButton, form.nextSibling);
  }
});

const closeEmailOverlay = document.getElementById('closeEmailOverlay');
closeEmailOverlay.addEventListener('click', () => {
  emailOverlay.style.display = 'none';
});

const addEmailButton = document.getElementById('addEmailButton');
addEmailButton.addEventListener('click', () => {
  const emailInput = document.createElement('input');
  emailInput.type = 'email';
  emailInput.placeholder = 'Enter email';
  emailInput.style.width = '100%';
  emailInput.style.marginBottom = '10px';
  document.getElementById('emailList').appendChild(emailInput);
});

const saveEmailSettings = document.getElementById('saveEmailSettings');
saveEmailSettings.addEventListener('click', () => {
  const emails = Array.from(document.querySelectorAll('#emailList input')).map(input => input.value.trim()).filter(email => email);
  const message = document.getElementById('emergencyMessage').value.trim();
  const autoEmail = document.getElementById('autoEmailCheckbox').checked;

  localStorage.setItem('emergencyEmails', JSON.stringify(emails));
  localStorage.setItem('emergencyMessage', message);
  localStorage.setItem('autoEmail', autoEmail);

  alert('Email settings saved!');
  emailOverlay.style.display = 'none';
});

// Add manual email sending functionality
const sendEmailsButton = document.getElementById('sendEmailsNow');
sendEmailsButton.addEventListener('click', () => {
  const emails = JSON.parse(localStorage.getItem('emergencyEmails')) || [];
  const message = localStorage.getItem('emergencyMessage') || '';
  const deviceId = localStorage.getItem('deviceId');

  if (emails.length === 0 || !message) {
    alert('Please ensure you have added emails and a message.');
    return;
  }

  fetch('/sendEmails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emails, message, deviceId })
  })
    .then(response => {
      if (!response.ok) throw new Error('Failed to send emails');
      alert('Emails sent successfully!');
    })
    .catch(error => {
      console.error('Error sending emails:', error);
      alert('Failed to send emails.');
    });
});

function loadEmailSettings() {
  const emails = JSON.parse(localStorage.getItem('emergencyEmails')) || [];
  const message = localStorage.getItem('emergencyMessage') || '';
  const autoEmail = localStorage.getItem('autoEmail') === 'true';

  document.getElementById('emergencyMessage').value = message;
  document.getElementById('autoEmailCheckbox').checked = autoEmail;

  const emailList = document.getElementById('emailList');
  emailList.innerHTML = '';
  emails.forEach(email => {
    const emailInput = document.createElement('input');
    emailInput.type = 'email';
    emailInput.value = email;
    emailInput.style.width = '100%';
    emailInput.style.marginBottom = '10px';
    emailList.appendChild(emailInput);
  });
}
