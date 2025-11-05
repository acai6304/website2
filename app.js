const selectors = {
  themeToggle: document.getElementById("theme-toggle"),
  controlForm: document.getElementById("control-form"),
  magnitudeSlider: document.getElementById("magnitude-slider"),
  magnitudeValue: document.getElementById("magnitude-value"),
  sortSelect: document.getElementById("sort-select"),
  showAftershocks: document.getElementById("show-aftershocks"),
  autoRefresh: document.getElementById("auto-refresh"),
  errorMessage: document.getElementById("error-message"),
  totalQuakes: document.getElementById("total-quakes"),
  strongestQuake: document.getElementById("strongest-quake"),
  strongestLocation: document.getElementById("strongest-location"),
  averageDepth: document.getElementById("average-depth"),
  quakeList: document.getElementById("quake-list"),
};

const STORAGE_KEYS = {
  theme: "earthquake-tracker-theme",
};

const FEED_LOOKUP = {
  hour: "all_hour",
  day: "all_day",
  week: "all_week",
};

const AUTO_REFRESH_INTERVAL = 60 * 1000; // 1 minute

let latestQuakes = [];
let markerLayer;
let markersById = new Map();
let mapInstance;
let autoRefreshTimer;

const escapeHtml = (value) =>
  typeof value === "string"
    ? value.replace(/[&<>"']/g, (char) => {
        const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
        return entities[char] ?? char;
      })
    : "";

const setError = (message) => {
  selectors.errorMessage.textContent = message;
  selectors.errorMessage.hidden = !message;
};

const initTheme = () => {
  const storedTheme = localStorage.getItem(STORAGE_KEYS.theme);
  if (storedTheme === "dark") {
    document.body.dataset.theme = "dark";
    selectors.themeToggle.textContent = "Switch to Light Mode";
  } else {
    document.body.dataset.theme = "";
    selectors.themeToggle.textContent = "Switch to Dark Mode";
  }
};

const toggleTheme = () => {
  const isDark = document.body.dataset.theme === "dark";
  const nextTheme = isDark ? "light" : "dark";
  if (nextTheme === "dark") {
    document.body.dataset.theme = "dark";
    selectors.themeToggle.textContent = "Switch to Light Mode";
  } else {
    document.body.dataset.theme = "";
    selectors.themeToggle.textContent = "Switch to Dark Mode";
  }
  localStorage.setItem(STORAGE_KEYS.theme, nextTheme);
};

const initMap = () => {
  mapInstance = L.map("map", {
    worldCopyJump: true,
    scrollWheelZoom: true,
    minZoom: 2,
    maxZoom: 10,
  }).setView([20, 0], 2.2);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(mapInstance);

  markerLayer = L.layerGroup().addTo(mapInstance);
};

const formatMagnitude = (value) => {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(1);
};

const formatDepth = (kilometers) => {
  if (!Number.isFinite(kilometers)) return "—";
  return `${kilometers.toFixed(1)} km`;
};

const formatTime = (timestamp) => {
  if (!Number.isFinite(timestamp)) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
};

const formatRelativeTime = (timestamp) => {
  if (!Number.isFinite(timestamp)) return "";
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
};

const getMagnitudeClass = (magnitude) => {
  if (!Number.isFinite(magnitude)) return "";
  if (magnitude >= 5.5) return "quake-mag quake-mag--strong";
  if (magnitude >= 4.5) return "quake-mag quake-mag--moderate";
  return "quake-mag quake-mag--light";
};

const magnitudeColor = (magnitude) => {
  if (!Number.isFinite(magnitude)) return "#4A5568";
  if (magnitude >= 6.5) return "#C53030";
  if (magnitude >= 5.5) return "#DD6B20";
  if (magnitude >= 4.5) return "#D69E2E";
  if (magnitude >= 3.5) return "#38A169";
  return "#3F63DD";
};

const getMinMagnitude = () => Number.parseFloat(selectors.magnitudeSlider.value) || 0;

const filterQuakes = () => {
  const minMagnitude = getMinMagnitude();
  return latestQuakes.filter((quake) => {
    if (!Number.isFinite(quake.magnitude)) {
      return minMagnitude <= 0;
    }
    return quake.magnitude >= minMagnitude;
  });
};

const sortQuakes = (quakes) => {
  const option = selectors.sortSelect.value;
  const compareTime = (a, b) => (b.time ?? 0) - (a.time ?? 0);
  const compareMagnitude = (a, b) => (b.magnitude ?? -Infinity) - (a.magnitude ?? -Infinity);

  const sorted = [...quakes];

  switch (option) {
    case "timeAsc":
      sorted.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
      break;
    case "magDesc":
      sorted.sort((a, b) => compareMagnitude(a, b) || compareTime(a, b));
      break;
    case "magAsc":
      sorted.sort((a, b) => (a.magnitude ?? Infinity) - (b.magnitude ?? Infinity) || compareTime(a, b));
      break;
    case "timeDesc":
    default:
      sorted.sort((a, b) => compareTime(a, b));
      break;
  }
  return sorted;
};

const updateMetrics = (quakes) => {
  if (!quakes.length) {
    selectors.totalQuakes.textContent = "0";
    selectors.strongestQuake.textContent = "—";
    selectors.strongestLocation.textContent = "No earthquakes match the current filters.";
    selectors.averageDepth.textContent = "—";
    return;
  }

  selectors.totalQuakes.textContent = quakes.length.toLocaleString();

  const strongest = quakes.reduce((top, quake) => {
    if (!Number.isFinite(quake.magnitude)) return top;
    if (!top || (quake.magnitude ?? -Infinity) > (top.magnitude ?? -Infinity)) return quake;
    return top;
  }, null);

  if (strongest) {
    selectors.strongestQuake.textContent = formatMagnitude(strongest.magnitude);
    selectors.strongestLocation.textContent = `${strongest.place} • ${formatTime(strongest.time)}`;
  } else {
    selectors.strongestQuake.textContent = "—";
    selectors.strongestLocation.textContent = "Magnitude unavailable for current selection.";
  }

  const depths = quakes
    .map((quake) => quake.depth)
    .filter((depth) => Number.isFinite(depth));

  if (depths.length) {
    const averageDepth = depths.reduce((sum, depth) => sum + depth, 0) / depths.length;
    selectors.averageDepth.textContent = `${averageDepth.toFixed(1)} km`;
  } else {
    selectors.averageDepth.textContent = "—";
  }
};

const renderMarkers = (quakes) => {
  markersById.clear();
  markerLayer.clearLayers();

  if (!quakes.length) {
    mapInstance.setView([20, 0], 2.2);
    return;
  }

  const bounds = [];

  quakes.forEach((quake) => {
    const { latitude, longitude } = quake.coordinates;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

    const color = magnitudeColor(quake.magnitude);
    const radius = Number.isFinite(quake.magnitude) ? Math.max(6, quake.magnitude * 2.2) : 6;
    const marker = L.circleMarker([latitude, longitude], {
      radius,
      color,
      weight: 2,
      fillColor: color,
      fillOpacity: 0.6,
    }).bindPopup(
      `<strong>${escapeHtml(quake.place)}</strong><br>Magnitude ${formatMagnitude(quake.magnitude)}<br>${formatTime(
        quake.time
      )}<br>Depth: ${formatDepth(quake.depth)}`
    );

    marker.addTo(markerLayer);
    markersById.set(quake.id, marker);
    bounds.push([latitude, longitude]);
  });

  if (bounds.length >= 2) {
    mapInstance.fitBounds(bounds, { padding: [40, 40], maxZoom: 6 });
  } else if (bounds.length === 1) {
    mapInstance.setView(bounds[0], 6);
  }
};

const renderList = (quakes) => {
  if (!quakes.length) {
    selectors.quakeList.innerHTML = `
      <p class="empty-state">No earthquakes meet your filters. Try widening the time window or lowering the magnitude threshold.</p>
    `;
    return;
  }

  const highlightAftershocks = selectors.showAftershocks.checked;

  selectors.quakeList.innerHTML = quakes
    .map((quake) => {
      const magnitudeBadge = Number.isFinite(quake.magnitude)
        ? `<span class="${getMagnitudeClass(quake.magnitude)}">M ${formatMagnitude(quake.magnitude)}</span>`
        : `<span class="quake-mag">M —</span>`;

      const isAftershock = Number.isFinite(quake.magnitude) && quake.magnitude < 3.5;
      const aftershockBadge =
        highlightAftershocks && isAftershock
          ? `<span class="aftershock-badge">Aftershock</span>`
          : "";

      return `
        <article class="quake-card" tabindex="0" data-id="${quake.id}">
          <div class="quake-card__header">
            ${magnitudeBadge}
            <span class="quake-time">${formatTime(quake.time)} • ${formatRelativeTime(quake.time)}</span>
          </div>
          <p class="quake-location">${escapeHtml(quake.place)}</p>
          <p class="quake-depth">Depth: ${formatDepth(quake.depth)} ${aftershockBadge}</p>
          <a class="hint" href="${quake.url}" target="_blank" rel="noopener">USGS event details</a>
        </article>
      `;
    })
    .join("");

  selectors.quakeList.querySelectorAll(".quake-card").forEach((card) => {
    const quakeId = card.dataset.id;
    const marker = markersById.get(quakeId);
    if (!marker) return;

    const emphasizeMarker = (isActive) => {
      marker.setStyle({
        weight: isActive ? 4 : 2,
        fillOpacity: isActive ? 0.85 : 0.6,
      });
      if (isActive) {
        marker.openPopup();
      }
    };

    const focusMap = () => {
      const { lat, lng } = marker.getLatLng();
      mapInstance.flyTo([lat, lng], Math.min(Math.max(mapInstance.getZoom(), 5), 7), {
        duration: 0.7,
      });
    };

    card.addEventListener("mouseenter", () => emphasizeMarker(true));
    card.addEventListener("mouseleave", () => emphasizeMarker(false));
    card.addEventListener("focus", () => emphasizeMarker(true));
    card.addEventListener("blur", () => emphasizeMarker(false));
    card.addEventListener("click", focusMap);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        focusMap();
      }
    });
  });
};

const render = () => {
  const filtered = filterQuakes();
  const sorted = sortQuakes(filtered);
  updateMetrics(sorted);
  renderMarkers(sorted);
  renderList(sorted);
};

const normaliseQuakeData = (features) =>
  features
    .map((feature) => {
      const [longitude, latitude, depth] = feature.geometry?.coordinates ?? [];
      return {
        id: feature.id,
        magnitude: typeof feature.properties?.mag === "number" ? feature.properties.mag : null,
        place: feature.properties?.place ?? "Unknown location",
        time: typeof feature.properties?.time === "number" ? feature.properties.time : null,
        url: feature.properties?.url ?? "#",
        depth: typeof depth === "number" ? depth : null,
        coordinates: {
          latitude,
          longitude,
        },
      };
    })
    .filter((quake) => Number.isFinite(quake.coordinates.latitude) && Number.isFinite(quake.coordinates.longitude));

const fetchEarthquakes = async () => {
  const selectedRange = selectors.controlForm.querySelector("input[name='timeRange']:checked")?.value ?? "day";
  const feed = FEED_LOOKUP[selectedRange] ?? FEED_LOOKUP.day;
  const endpoint = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feed}.geojson`;

  selectors.quakeList.innerHTML = `<p class="empty-state">Loading the latest earthquake data…</p>`;
  setError("");

  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`USGS feed returned status ${response.status}`);
    }
    const data = await response.json();
    if (!data?.features) {
      throw new Error("Unexpected response format.");
    }
    latestQuakes = normaliseQuakeData(data.features);
    render();
  } catch (error) {
    console.error(error);
    setError("We could not load the latest earthquakes. Please try again later.");
    selectors.quakeList.innerHTML = `
      <p class="empty-state">Unable to load earthquake data. Check your connection and try again.</p>
    `;
    updateMetrics([]);
    markerLayer.clearLayers();
  }
};

const handleMagnitudeChange = () => {
  const minMagnitude = getMinMagnitude();
  selectors.magnitudeValue.textContent = minMagnitude.toFixed(1);
  render();
};

const setupAutoRefresh = () => {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }
  if (selectors.autoRefresh.checked) {
    autoRefreshTimer = setInterval(fetchEarthquakes, AUTO_REFRESH_INTERVAL);
  }
};

const init = () => {
  initTheme();
  initMap();

  selectors.themeToggle.addEventListener("click", toggleTheme);

  selectors.controlForm.addEventListener("change", (event) => {
    if (event.target.name === "timeRange") {
      fetchEarthquakes();
    } else if (event.target === selectors.sortSelect || event.target === selectors.showAftershocks) {
      render();
    } else if (event.target === selectors.autoRefresh) {
      setupAutoRefresh();
    }
  });

  selectors.magnitudeSlider.addEventListener("input", handleMagnitudeChange);
  selectors.magnitudeSlider.addEventListener("change", render);

  handleMagnitudeChange();
  fetchEarthquakes();
  setupAutoRefresh();
};

document.addEventListener("DOMContentLoaded", init);
