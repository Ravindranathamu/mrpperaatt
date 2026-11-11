'use strict';

/**
 * Great-circle distance between two GPS points, in metres.
 */
function distanceMeters(lat1, lon1, lat2, lon2) {
  const values = [lat1, lon1, lat2, lon2].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return Number.POSITIVE_INFINITY;
  const [aLat, aLon, bLat, bLon] = values;
  if (Math.abs(aLat) > 90 || Math.abs(bLat) > 90 || Math.abs(aLon) > 180 || Math.abs(bLon) > 180) {
    return Number.POSITIVE_INFINITY;
  }

  const earthRadius = 6371008.8;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const phi1 = toRadians(aLat);
  const phi2 = toRadians(bLat);
  const deltaPhi = toRadians(bLat - aLat);
  const deltaLambda = toRadians(bLon - aLon);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = { distanceMeters };
