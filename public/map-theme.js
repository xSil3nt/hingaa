// Lilac Coast — the selected hingaa palette.
export const mapPalette={water:'#e0e2f5',land:'#faf8f0',park:'#dce8df',road:'#ffffff',paper:'#fffefb',bus:'#585b9d',transfer:'#337e79',walk:'#808494',vehicle:'#f5c95e'};
export const darkMapPalette={water:'#10242d',land:'#252a34',park:'#263b37',road:'#434b56',paper:'#111a23',bus:'#38c3df',transfer:'#e1a345',walk:'#e1a345',vehicle:'#e1a345',label:'#bdc8d0',roadLabel:'#95a6b1'};
export function mapStyles(zoom=14,palette=mapPalette){return [
 {elementType:'geometry',stylers:[{color:palette.land}]},
 {elementType:'labels',stylers:[{visibility:'off'}]},
 {featureType:'administrative.locality',elementType:'labels.text',stylers:[{visibility:'on'}]},
 {featureType:'administrative.locality',elementType:'labels.text.fill',stylers:[{color:palette.label||'#59606b'}]},
 {featureType:'administrative.locality',elementType:'labels.text.stroke',stylers:[{color:palette.land},{weight:3}]},
 {featureType:'poi',stylers:[{visibility:'off'}]},
 {featureType:'poi.park',elementType:'geometry',stylers:[{visibility:'on'},{color:palette.park}]},
 {featureType:'road',elementType:'geometry.fill',stylers:[{color:palette.road}]},
 {featureType:'road',elementType:'geometry.stroke',stylers:[{color:palette.land},{weight:.5}]},
 {featureType:'road',elementType:'labels.text',stylers:[{visibility:zoom>=16?'on':'off'}]},
 {featureType:'road',elementType:'labels.text.fill',stylers:[{color:palette.roadLabel||'#737684'}]},
 {featureType:'road',elementType:'labels.text.stroke',stylers:[{color:palette.land},{weight:3}]},
 {featureType:'transit',stylers:[{visibility:'off'}]},
 {featureType:'water',elementType:'geometry',stylers:[{color:palette.water}]}
];}
