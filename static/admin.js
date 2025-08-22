// Map initialization
const map = L.map('map').setView([20.0, 77.0], 5);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// UI Elements
const refreshBtn = document.getElementById('refreshBtn');
const removeBtn = document.getElementById('removeBtn');
const addCampBtn = document.getElementById('addCampBtn');
const saveCampsBtn = document.getElementById('saveCampsBtn');
const toggleListViewBtn = document.getElementById('toggleListViewBtn');
const adminLocationBtn = document.getElementById('adminLocationBtn');
const counter = document.getElementById('counter');
const listView = document.getElementById('listView');
const sosList = document.getElementById('sosList');

// Emergency markers storage
const markers = {};
let selectedMarkerId = null;
let selectedCampIndex = null;

// Relief camps storage
let reliefCamps = [];
let campMarkers = [];
let isAddingCamp = false;

// Admin location
let adminMarker = null;
let adminAccuracyCircle = null;
let adminPosition = null;
let adminManualMarker = null;
let isAdminLocationActive = false;

// Custom icons
const maleIcon = L.icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/3011/3011270.png',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32]
});

const femaleIcon = L.icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/3011/3011292.png',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32]
});

const maleManualIcon = L.icon({
  iconUrl: 'https://cdn2.iconfinder.com/data/icons/ultimate-business-icons/64/1-08-512.png',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32]
});

const femaleManualIcon = L.icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/12117/12117624.png',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32]
});

const selectedIcon = L.icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/1828/1828843.png',
  iconSize: [32, 32],
  iconAnchor: [16, 32]
});

const campIcon = L.icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/4850/4850336.png',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  className: 'relief-camp-marker'
});

const selectedCampIcon = L.icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/1828/1828843.png',
  iconSize: [32, 32],
  iconAnchor: [16, 32]
});

const adminIcon = L.icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/228/228382.png',
  iconSize: [32, 32],
  iconAnchor: [16, 16]
});

// Initialize
fetchReliefCamps();
updateEmergencies();

let isUpdating = false; // Prevent redundant updates

async function updateEmergencies() {
  if (isUpdating) return;
  isUpdating = true;

  try {
    const response = await fetch('/getActiveSOS');
    let emergencies = await response.json();

    // ✅ Apply ID filter early — only keep emergencies matching filterId
    if (idFilterActive) {
      emergencies = emergencies.filter(e => e.deviceId === filterId);
    }

    counter.textContent = `${emergencies.length} Active Emergencies`;

    // Remove old markers
    Object.keys(markers).forEach(id => {
      if (!emergencies.some(e => e.deviceId === id)) {
        if (selectedMarkerId === id) {
          selectedMarkerId = null;
          removeBtn.disabled = true;
        }
        map.removeLayer(markers[id].marker);
        if (markers[id].circle) map.removeLayer(markers[id].circle);
        delete markers[id];
      }
    });

    // Add/update markers for filtered emergencies only
    emergencies.forEach(emergency => {
      const { deviceId, lat, lon, name, gender, age, accuracy, isManual, timestamp } = emergency;

      let icon = isManual
        ? (gender === 'female' ? femaleManualIcon : maleManualIcon)
        : (gender === 'female' ? femaleIcon : maleIcon);

      if (!markers[deviceId]) {
        const marker = L.marker([lat, lon], { icon })
          .addTo(map)
          .bindPopup(createEmergencyPopupContent(emergency))
          .on('click', () => selectEmergency(deviceId));

        let circle = null;
        if (!isManual && accuracy > 0) {
          const circleColor = gender === 'female' ? '#d63384' : '#0d6efd';
          circle = L.circle([lat, lon], {
            radius: accuracy,
            color: circleColor,
            fillOpacity: 0.2
          }).addTo(map);
        }

        markers[deviceId] = { marker, circle, emergency };
      } else {
        markers[deviceId].emergency = emergency;
        markers[deviceId].marker.setLatLng([lat, lon]);
        markers[deviceId].marker.setPopupContent(createEmergencyPopupContent(emergency));

        if (selectedMarkerId !== deviceId) {
          markers[deviceId].marker.setIcon(icon);
        }

        if (markers[deviceId].circle) {
          markers[deviceId].circle.setLatLng([lat, lon]);
          markers[deviceId].circle.setRadius(accuracy);
        }
      }
    });

    // Gender/age filters
    const filteredEmergencies = emergencies.filter(emergency => {
      if (filters.gender && emergency.gender !== filters.gender) return false;
      if (filters.minAge && emergency.age < filters.minAge) return false;
      if (filters.maxAge && emergency.age > filters.maxAge) return false;
      return true;
    });

    if (filters.distance) {
      const adminLocation = getAdminLocation();
      filteredEmergencies.sort((a, b) => {
        const distA = calculateDistance(adminLocation.lat, adminLocation.lng, a.lat, a.lon);
        const distB = calculateDistance(adminLocation.lat, adminLocation.lng, b.lat, b.lon);
        return filters.distance === 'asc' ? distA - distB : distB - distA;
      });
    }

    updateListView(filteredEmergencies);
    updateMapMarkers(filteredEmergencies); // ✅ Already filtered by ID above
  } catch (error) {
    console.error('Error:', error);
    counter.textContent = 'Error loading data';
  } finally {
    isUpdating = false;
  }
}

function createEmergencyPopupContent(emergency) {
  return `
    <div class="info-popup">
      <b>${emergency.name}</b> (${emergency.age}y)<br>
      Gender: ${emergency.gender}<br>
      ${emergency.isManual ? '📍 Manual location' : `📍 GPS (Accuracy: ${emergency.accuracy}m)`}<br>
      <small>${new Date(emergency.timestamp).toLocaleString()}</small>
    </div>
  `;
}

function createCampPopupContent(camp) {
  return `
    <div class="info-popup">
      <b>${camp.name || 'Relief Camp'}</b><br>
      <small>Lat: ${camp.lat.toFixed(4)}, Lng: ${camp.lng.toFixed(4)}</small>
    </div>
  `;
}

// Selection functions
function selectEmergency(deviceId) {
  // Deselect any selected camp
  if (selectedCampIndex !== null) {
    campMarkers[selectedCampIndex].setIcon(campIcon);
    selectedCampIndex = null;
  }
  
  // Deselect previous emergency if different
  if (selectedMarkerId && selectedMarkerId !== deviceId) {
    const prevEmergency = markers[selectedMarkerId].emergency;
    const prevIcon = getIconForEmergency(prevEmergency);
    markers[selectedMarkerId].marker.setIcon(prevIcon);
  }
  
  // Select new emergency
  selectedMarkerId = deviceId;
  markers[deviceId].marker.setIcon(selectedIcon);
  removeBtn.disabled = false;
}

function selectCamp(index) {
  // Deselect any selected emergency
  if (selectedMarkerId) {
    const emergency = markers[selectedMarkerId].emergency;
    const icon = getIconForEmergency(emergency);
    markers[selectedMarkerId].marker.setIcon(icon);
    selectedMarkerId = null;
  }
  
  // Deselect previous camp if different
  if (selectedCampIndex !== null && selectedCampIndex !== index) {
    campMarkers[selectedCampIndex].setIcon(campIcon);
  }
  
  // Select new camp
  selectedCampIndex = index;
  campMarkers[index].setIcon(selectedCampIcon);
  removeBtn.disabled = false;
}

function getIconForEmergency(emergency) {
  if (emergency.isManual) {
    return emergency.gender === 'female' ? femaleManualIcon : maleManualIcon;
  }
  return emergency.gender === 'female' ? femaleIcon : maleIcon;
}

// Remove selected item
async function removeSelected() {
  if (selectedMarkerId) {
    await removeEmergency(selectedMarkerId);
    selectedMarkerId = null;
  } else if (selectedCampIndex !== null) {
    await removeReliefCamp(selectedCampIndex);
    selectedCampIndex = null;
  }
  removeBtn.disabled = true;
}

async function removeEmergency(deviceId) {
  try {
    const response = await fetch('/removeSOS', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId })
    });
    
    if (response.ok) {
      map.removeLayer(markers[deviceId].marker);
      if (markers[deviceId].circle) {
        map.removeLayer(markers[deviceId].circle);
      }
      delete markers[deviceId];
      updateEmergencies();
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

async function removeReliefCamp(index) {
  try {
    const response = await fetch('/removeReliefCamp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index })
    });
    
    if (response.ok) {
      await fetchReliefCamps();
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

// Relief camp functions
async function fetchReliefCamps() {
  try {
    const response = await fetch('/getReliefCamps');
    reliefCamps = await response.json();
    updateReliefCamps();
  } catch (error) {
    console.error('Error fetching relief camps:', error);
  }
}

function updateReliefCamps() {
  // Clear existing camp markers
  campMarkers.forEach(marker => map.removeLayer(marker));
  campMarkers = [];
  
  // Add new markers
  reliefCamps.forEach((camp, index) => {
    const marker = L.marker([camp.lat, camp.lng], {
      icon: campIcon,
      zIndexOffset: 1000
    })
    .bindPopup(createCampPopupContent(camp))
    .on('click', () => selectCamp(index))
    .addTo(map);
    
    campMarkers.push(marker);
  });
}

async function addReliefCamp(lat, lng, name) {
  try {
    const response = await fetch('/addReliefCamp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng, name })
    });
    
    if (response.ok) {
      await fetchReliefCamps();
    } else {
      console.error('Failed to add relief camp:', response.statusText);
      alert('Failed to add relief camp. Please check console for details.');
    }
  } catch (error) {
    console.error('Error adding relief camp:', error);
    alert('Error adding relief camp: ' + error.message);
  }
}

async function saveReliefCamps() {
  try {
    alert('Relief camps have been saved to the server!');
  } catch (error) {
    console.error('Error saving camps:', error);
    alert('Failed to save camps');
  }
}

// Admin location functions
function toggleAdminLocation() {
  isAdminLocationActive = !isAdminLocationActive;

  if (isAdminLocationActive) {
    adminLocationBtn.classList.add('active');
    adminLocationBtn.innerHTML = '<img src="https://cdn-icons-png.flaticon.com/128/14831/14831599.png" width="25" alt=""> My Location (Active)';
    getAndSetAdminLocation();
    map.on('click', handleManualAdminLocation);
  } else {
    adminLocationBtn.classList.remove('active');
    adminLocationBtn.innerHTML = '<img src="https://cdn-icons-png.flaticon.com/128/14831/14831599.png" width="25" alt=""> My Location';
    clearAdminLocation();
    map.off('click', handleManualAdminLocation);
  }
}

function getAndSetAdminLocation() {
  clearAdminLocation();

  const mapContainer = document.querySelector('.leaflet-container');

  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser. Please place your location manually.');
    if (mapContainer) mapContainer.classList.add('crosshair-mode');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      adminPosition = { lat: latitude, lng: longitude };

      adminMarker = L.marker([latitude, longitude], { icon: adminIcon })
        .bindPopup('Your Location')
        .addTo(map);

      if (accuracy && accuracy > 0) {
        adminAccuracyCircle = L.circle([latitude, longitude], {
          radius: accuracy,
          color: '#198754',
          fillOpacity: 0.15
        }).addTo(map);
      }

      // If accuracy is poor, prompt for manual placement
      if (accuracy > 100) {
        alert('Location accuracy is poor (' + Math.round(accuracy) + 'm). Please click on the map to place your location manually.');
        if (mapContainer) mapContainer.classList.add('crosshair-mode');
      } else {
        if (mapContainer) mapContainer.classList.remove('crosshair-mode');
      }
    },
    (err) => {
      alert('Unable to retrieve your location. Please click on the map to place your location manually.');
      if (mapContainer) mapContainer.classList.add('crosshair-mode');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function handleManualAdminLocation(e) {
  if (!isAdminLocationActive) return;

  const mapContainer = document.querySelector('.leaflet-container');

  // Only allow placing manual marker if it doesn't already exist
  if (adminManualMarker) return;

  adminManualMarker = L.marker(e.latlng, { icon: adminIcon })
    .bindPopup('Your Manual Location')
    .addTo(map);

  adminPosition = { lat: e.latlng.lat, lng: e.latlng.lng };

  if (adminMarker) {
    map.removeLayer(adminMarker);
    adminMarker = null;
  }
  if (adminAccuracyCircle) {
    map.removeLayer(adminAccuracyCircle);
    adminAccuracyCircle = null;
  }

  if (mapContainer) mapContainer.classList.remove('crosshair-mode');

  updateListView(Object.values(markers).map(m => m.emergency));
}

function clearAdminLocation() {
  if (adminMarker) {
    map.removeLayer(adminMarker);
    adminMarker = null;
  }
  if (adminAccuracyCircle) {
    map.removeLayer(adminAccuracyCircle);
    adminAccuracyCircle = null;
  }
  if (adminManualMarker) {
    map.removeLayer(adminManualMarker);
    adminManualMarker = null;
  }
  adminPosition = null;

  const mapContainer = document.querySelector('.leaflet-container');
  if (mapContainer) mapContainer.classList.remove('crosshair-mode');
}

// List view functions
function toggleListView() {
  listView.classList.toggle('visible');
}

function updateListView(emergencies) {
  let filteredEmergencies = emergencies;
  if (idFilterActive) {
    filteredEmergencies = emergencies.filter(e => e.deviceId === filterId);
  }
  
  if (!filteredEmergencies || !Array.isArray(filteredEmergencies)) return;
  
  sosList.innerHTML = '';
  
  // console.log('Rendering emergencies in list view:', filteredEmergencies);
  
  filteredEmergencies.forEach(emergency => {
    const item = document.createElement('div');
    item.className = 'sos-item';
    
    // Determine icon URL based on emergency type
    let iconUrl;
    if (emergency.isManual) {
      iconUrl = emergency.gender === 'female' ? 
        'https://cdn-icons-png.flaticon.com/512/12117/12117624.png' : 
        'https://cdn2.iconfinder.com/data/icons/ultimate-business-icons/64/1-08-512.png';
    } else {
      iconUrl = emergency.gender === 'female' ? 
        'https://cdn-icons-png.flaticon.com/512/3011/3011292.png' : 
        'https://cdn-icons-png.flaticon.com/512/3011/3011270.png';
    }
    
    // Calculate distance if admin position is available
    let distanceHtml = '';
    if (adminPosition) {
      const distance = calculateDistance(
        adminPosition.lat, adminPosition.lng,
        emergency.lat, emergency.lon
      );
      distanceHtml = `<div class="sos-distance">${formatDistance(distance)}</div>`;
    }
    
    item.innerHTML = `
      <div class="sos-icon" style="background-image: url('${iconUrl}')"></div>
      <div class="sos-details">
        <div class="sos-name">${emergency.name || 'Unknown'}</div>
        <div class="sos-meta">
          ${emergency.age || '?'} years, ${emergency.gender || 'unknown'}
        </div>
        <div class="sos-meta">
          ${new Date(emergency.timestamp).toLocaleString()}
        </div>
        ${distanceHtml}
      </div>
    `;
    
    sosList.appendChild(item);
  });
  
  // console.log('Filtered Emergencies:', emergencies);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // meters
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

function formatDistance(distance) {
  if (distance >= 1000) {
    return `${(distance/1000).toFixed(1)} km away`;
  }
  return `${Math.round(distance)} m away`;
}

// Utility to get URL parameter
function getUrlParameter(name) {
  name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
  const regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
  const results = regex.exec(window.location.search);
  return results === null ? null : decodeURIComponent(results[1].replace(/\+/g, ' '));
}

// On page load, filter by id if present
const filterId = getUrlParameter('id');
let idFilterActive = false;
if (filterId) {
  idFilterActive = true;
}

// Hide controls if id param is present
if (idFilterActive) {
  document.addEventListener('DOMContentLoaded', function() {
    const controls = document.getElementById('controls');
    if (controls) controls.style.display = 'none';
  });
}

// Event Listeners
refreshBtn.addEventListener('click', updateEmergencies);
removeBtn.addEventListener('click', removeSelected);
adminLocationBtn.addEventListener('click', toggleAdminLocation);
toggleListViewBtn.addEventListener('click', toggleListView);

addCampBtn.addEventListener('click', () => {
  isAddingCamp = !isAddingCamp;
  addCampBtn.textContent = isAddingCamp ? '❌ Cancel Adding' : '➕ Add Relief Camp';
  
  // Deselect any selected items when toggling camp adding
  if (isAddingCamp) {
    if (selectedMarkerId) {
      const emergency = markers[selectedMarkerId].emergency;
      const icon = getIconForEmergency(emergency);
      markers[selectedMarkerId].marker.setIcon(icon);
      selectedMarkerId = null;
    }
    if (selectedCampIndex !== null) {
      campMarkers[selectedCampIndex].setIcon(campIcon);
      selectedCampIndex = null;
    }
    removeBtn.disabled = true;
  }
});

saveCampsBtn.addEventListener('click', saveReliefCamps);

map.on('click', (e) => {
  if (isAddingCamp) {
    const name = prompt('Enter relief camp name:', 'Emergency Shelter');
    if (name !== null) {
      addReliefCamp(e.latlng.lat, e.latlng.lng, name.trim());
      isAddingCamp = false;
      addCampBtn.textContent = '➕ Add Relief Camp';
    }
  }
  
  // Deselect when clicking on empty map space
  if (selectedMarkerId) {
    const emergency = markers[selectedMarkerId].emergency;
    const icon = getIconForEmergency(emergency);
    markers[selectedMarkerId].marker.setIcon(icon);
    selectedMarkerId = null;
    removeBtn.disabled = true;
  }
  
  if (selectedCampIndex !== null) {
    campMarkers[selectedCampIndex].setIcon(campIcon);
    selectedCampIndex = null;
    removeBtn.disabled = true;
  }
});

map.on('click', (e) => {
  if (isAdminLocationActive) {
    // Remove existing admin marker and accuracy circle
    if (adminMarker) {
      map.removeLayer(adminMarker);
      adminMarker = null;
    }
    if (adminAccuracyCircle) {
      map.removeLayer(adminAccuracyCircle);
      adminAccuracyCircle = null;
    }

    // Place manual marker
    if (!adminManualMarker) {
      adminManualMarker = L.marker(e.latlng, { icon: adminIcon })
        .bindPopup('Your Manual Location')
        .addTo(map);
      adminPosition = { lat: e.latlng.lat, lng: e.latlng.lng };
      updateListView(Object.values(markers).map(m => m.emergency));
    }
  }
});

function updateMapMarkers(emergencies) {
  let filteredEmergencies = emergencies;
  if (idFilterActive) {
    filteredEmergencies = emergencies.filter(e => e.deviceId === filterId);
  }
  Object.keys(markers).forEach(id => {
    const marker = markers[id];
    if (filteredEmergencies.some(e => e.deviceId === id)) {
      marker.marker.addTo(map);
      if (marker.circle) marker.circle.addTo(map);
    } else {
      map.removeLayer(marker.marker);
      if (marker.circle) map.removeLayer(marker.circle);
    }
  });
}

// Auto-refresh
setInterval(updateEmergencies, 3000);