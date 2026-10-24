// Editable palette and embedded Google Maps style. No Cloud map ID required.
export const mapPalette = {
  water: '#b9e6dd', land: '#f2e7df', park: '#d3e8d9',
  road: '#ffffff', roadEdge: '#dddcd0', text: '#526c65',
  bus: '#48599f', transfer: '#177d70', walk: '#687585', vehicle: '#f5c95e'
};
export const mapStyle = [
  {elementType:'geometry',stylers:[{color:mapPalette.land}]},
  {elementType:'labels.text.fill',stylers:[{color:mapPalette.text}]},
  {elementType:'labels.text.stroke',stylers:[{color:mapPalette.land},{weight:3}]},
  {elementType:'labels.icon',stylers:[{visibility:'off'}]},
  {featureType:'poi',stylers:[{visibility:'off'}]},
  {featureType:'poi.park',elementType:'geometry',stylers:[{visibility:'on'},{color:mapPalette.park}]},
  {featureType:'transit',stylers:[{visibility:'off'}]},
  {featureType:'administrative.land_parcel',stylers:[{visibility:'off'}]},
  {featureType:'administrative.neighborhood',elementType:'labels',stylers:[{visibility:'off'}]},
  {featureType:'road',elementType:'geometry.fill',stylers:[{color:mapPalette.road}]},
  {featureType:'road',elementType:'geometry.stroke',stylers:[{color:mapPalette.roadEdge},{weight:0.5}]},
  {featureType:'road.highway',elementType:'geometry.fill',stylers:[{color:'#e7dcc1'}]},
  {featureType:'road.highway',elementType:'geometry.stroke',stylers:[{color:'#d8ccaf'}]},
  {featureType:'road.local',elementType:'labels.text.fill',stylers:[{color:'#7a8980'}]},
  {featureType:'water',elementType:'geometry',stylers:[{color:mapPalette.water}]},
  {featureType:'water',elementType:'labels.text.fill',stylers:[{color:'#568681'}]}
];
