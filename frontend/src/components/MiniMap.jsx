import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Default icon fix for webpack
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function FlyTo({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.flyTo(position, 14, { duration: 0.6 });
  }, [position, map]);
  return null;
}

function ClickHandler({ onPick }) {
  useMapEvents({
    click(e) {
      if (onPick) onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function MiniMap({ lat, lng, height = 160, interactive = false, onPick }) {
  const [pos, setPos] = useState(lat != null && lng != null ? [lat, lng] : null);
  useEffect(() => {
    if (lat != null && lng != null) setPos([lat, lng]);
  }, [lat, lng]);

  if (!pos) return null;
  return (
    <div
      className="rounded-sm overflow-hidden border border-border"
      style={{ height }}
      data-testid="mini-map"
    >
      <MapContainer
        center={pos}
        zoom={14}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={interactive}
        dragging={interactive}
        doubleClickZoom={interactive}
        zoomControl={interactive}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={pos} />
        <FlyTo position={pos} />
        {interactive && <ClickHandler onPick={(la, ln) => { setPos([la, ln]); onPick && onPick(la, ln); }} />}
      </MapContainer>
    </div>
  );
}
