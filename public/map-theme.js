// Lilac Coast — the selected hingaa palette.
export const mapPalette={water:'#e0e2f5',land:'#faf8f0',park:'#dce8df',road:'#ffffff',paper:'#fffefb',bus:'#585b9d',transfer:'#337e79',walk:'#808494',vehicle:'#f5c95e'};
export function mapStyles(zoom=14){return [
 {elementType:'geometry',stylers:[{color:mapPalette.land}]},
 {elementType:'labels',stylers:[{visibility:'off'}]},
 {featureType:'administrative.locality',elementType:'labels.text',stylers:[{visibility:'on'}]},
 {featureType:'administrative.locality',elementType:'labels.text.fill',stylers:[{color:'#59606b'}]},
 {featureType:'administrative.locality',elementType:'labels.text.stroke',stylers:[{color:mapPalette.land},{weight:3}]},
 {featureType:'poi',stylers:[{visibility:'off'}]},
 {featureType:'poi.park',elementType:'geometry',stylers:[{visibility:'on'},{color:mapPalette.park}]},
 {featureType:'road',elementType:'geometry.fill',stylers:[{color:mapPalette.road}]},
 {featureType:'road',elementType:'geometry.stroke',stylers:[{color:mapPalette.land},{weight:.5}]},
 {featureType:'road',elementType:'labels.text',stylers:[{visibility:zoom>=16?'on':'off'}]},
 {featureType:'road',elementType:'labels.text.fill',stylers:[{color:'#737684'}]},
 {featureType:'road',elementType:'labels.text.stroke',stylers:[{color:mapPalette.land},{weight:3}]},
 {featureType:'transit',stylers:[{visibility:'off'}]},
 {featureType:'water',elementType:'geometry',stylers:[{color:mapPalette.water}]}
];}
