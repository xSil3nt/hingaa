// An atlas-like base: pale periwinkle sea, cream islands, mint parks, sparse labels.
export const mapPalette={water:'#dce4f4',land:'#eee3dc',park:'#b8e7d6',road:'#fffaf5',roadEdge:'#e0d2cb',text:'#55556b',bus:'#6475ca',transfer:'#177d70',walk:'#73778b',vehicle:'#f5c95e'};
export function mapStyles(zoom=13){return [
  {elementType:'geometry',stylers:[{color:mapPalette.land}]},
  {elementType:'labels',stylers:[{visibility:'off'}]},
  {featureType:'administrative.locality',elementType:'labels.text',stylers:[{visibility:'on'}]},
  {featureType:'administrative.locality',elementType:'labels.text.fill',stylers:[{color:mapPalette.text}]},
  {featureType:'administrative.locality',elementType:'labels.text.stroke',stylers:[{color:mapPalette.land},{weight:3}]},
  {featureType:'poi',stylers:[{visibility:'off'}]},
  {featureType:'poi.park',elementType:'geometry',stylers:[{visibility:'on'},{color:mapPalette.park}]},
  {featureType:'transit',stylers:[{visibility:'off'}]},
  {featureType:'road',elementType:'geometry.fill',stylers:[{color:mapPalette.road}]},
  {featureType:'road',elementType:'geometry.stroke',stylers:[{color:mapPalette.roadEdge},{weight:0.3}]},
  {featureType:'road.highway',elementType:'geometry.fill',stylers:[{color:mapPalette.road}]},
  {featureType:'road.highway',elementType:'geometry.stroke',stylers:[{color:mapPalette.roadEdge},{weight:0.3}]},
  {featureType:'road',elementType:'labels.text',stylers:[{visibility:zoom>=16?'on':'off'}]},
  {featureType:'road',elementType:'labels.text.fill',stylers:[{color:'#797185'}]},
  {featureType:'road',elementType:'labels.text.stroke',stylers:[{color:mapPalette.land},{weight:3}]},
  {featureType:'water',elementType:'geometry',stylers:[{color:mapPalette.water}]}
];}
export const mapStyle=mapStyles();
