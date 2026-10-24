// A small margin around Malé, Hulhulé airport and Hulhumalé.
export const mapRegion=Object.freeze({south:4.155,west:73.495,north:4.255,east:73.558});
export const mapZoom=Object.freeze({min:12,max:20});
export const leafletRegionOptions={maxBounds:[[mapRegion.south,mapRegion.west],[mapRegion.north,mapRegion.east]],maxBoundsViscosity:1,minZoom:mapZoom.min,maxZoom:mapZoom.max};
