import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import maplibregl from 'maplibre-gl';

// A marker pinned to the map at [lng, lat] whose content is ordinary React,
// so markers are real buttons, styled by the design system and reachable by
// keyboard. MapLibre moves the element as the map pans and zooms.
const MapMarker = ({ map, lng, lat, children }) => {
  const [element] = useState(() => {
    // The content is the control; MapLibre would otherwise make the wrapper a
    // "Map marker" button around it.
    const wrapper = document.createElement('div');
    wrapper.setAttribute('role', 'presentation');
    return wrapper;
  });

  useEffect(() => {
    const marker = new maplibregl.Marker({ element }).setLngLat([lng, lat]).addTo(map);
    element.removeAttribute('aria-label');
    return () => marker.remove();
  }, [map, element, lng, lat]);

  return createPortal(children, element);
};

export default MapMarker;
