import IcCircle from "~/assets/icons/ic-circle.svg";
import IcGlobe from "~/assets/icons/ic-globe.svg";
import Ic3d from "~/assets/icons/ic-3d.svg";
import IcMapLayerA from "~/assets/icons/ic-map-layer-a.svg";
import IcMapLayerB from "~/assets/icons/ic-map-layer-b.svg";
import IcMin from "~/assets/icons/ic-min.svg";
import IcPicture from "~/assets/icons/ic-picture.svg";
import IcDrawFree from "~/assets/icons/ic-draw-free.svg";

export const expiresTokenKey = "epoch_expires_geo_refresh";
// export const mapApiKey = "D7JUUxLv3oK21JM9jscD";
export const orsApiKey =
  "5b3ce3597851110001cf6248a74916be492f4775af9522b9c91d851c";
export const googleMapsApiKey = "AIzaSyDn0tJdrXi1ZuyFVaV3gI0YtDGixPujae0";

export const uncategorizedAlias = "Others";
export const uncategorizedLoadedData = "Loaded Data";

export const geomTypeCircle = "Circle";
export const geomTypeSymbol = "Symbol";
export const geomTypePolygon = "Polygon";
export const geomTypeLine = "Line";
export const geomTypeRaster = "Raster";
export const geomTypeTerrain = "Terrain";
export const geomTypeThreeD = "3D";

export const layerTypeFilterOptions = [
  { type: "all", label: "All Format", checked: true, icon: IcMapLayerB },
  { type: geomTypeCircle, label: "Circle", checked: false, icon: IcCircle },
  { type: geomTypeLine, label: "Line", checked: false, icon: IcMin },
  { type: geomTypePolygon, label: "Polygon", checked: false, icon: IcDrawFree },
  { type: geomTypeRaster, label: "Raster", checked: false, icon: IcPicture },
];

export const dimensionFilterOptions = [
  { type: "all", label: "All Dimension", checked: true, icon: IcMapLayerA },
  { type: "2D", label: "2D", checked: false, icon: IcGlobe },
  { type: "3D", label: "3D", checked: false, icon: Ic3d },
];

export const logicalOperatorOptions = [
  { label: "Contains", value: "_icontains" },
  { label: "Equal", value: "_eq" },
];

export const layerDataFolderId = "ffffffff-ffff-4fff-bfff-fffffffffffb";
export const layerPreviewFolderId = "ffffffff-ffff-4fff-bfff-fffffffffffd";
export const layerIconsFolderId = "ffffffff-ffff-4fff-bfff-fffffffffffe";

export const staticKey = { other: "other", loadedData: "loadedData" };

export const towerIconSvg = `<svg width="29" height="29" viewBox="0 0 29 29" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.5797 12.2558L21.7928 11.72C22.713 10.3641 23.2488 8.78424 23.3431 7.1483C23.4374 5.51236 23.0869 3.88141 22.3286 2.42873L22.1696 2.13673L22.9991 1.66797L23.1721 1.98606C24.0105 3.59163 24.3982 5.39441 24.2939 7.20272C24.1896 9.01102 23.5972 10.7573 22.5797 12.2558ZM24.7742 25.8398V26.668H3.82178V25.8398H8.56197L11.5119 12.1918C11.5578 11.979 11.6753 11.7883 11.8447 11.6516C12.0141 11.5149 12.2252 11.4403 12.4429 11.4403H13.8248V8.76587C13.3497 8.65577 12.9255 8.38894 12.6206 8.00837C12.3156 7.6278 12.1476 7.15564 12.1437 6.66797C12.1437 6.37861 12.2007 6.09209 12.3114 5.82475C12.4221 5.55742 12.5844 5.31452 12.7891 5.10991C12.9937 4.9053 13.2366 4.743 13.5039 4.63227C13.7712 4.52153 14.0578 4.46454 14.3471 4.46454C14.6365 4.46454 14.923 4.52153 15.1903 4.63227C15.4577 4.743 15.7006 4.9053 15.9052 5.10991C16.1098 5.31452 16.2721 5.55742 16.3828 5.82475C16.4935 6.09209 16.5505 6.37861 16.5505 6.66797C16.5463 7.1717 16.3671 7.6583 16.0436 8.04443C15.7201 8.43056 15.2724 8.6922 14.7772 8.78454V11.4411H16.153C16.3706 11.4411 16.5816 11.5156 16.7509 11.6521C16.9203 11.7887 17.0378 11.9792 17.0839 12.1918L20.0321 25.839L24.7742 25.8398ZM16.1031 16.6699H12.4926L11.8778 19.5139H16.7178L16.1031 16.6699ZM11.6719 20.4663L11.0561 23.3143H17.5391L16.9237 20.4663H11.6719ZM13.2111 13.3459L12.6985 15.7175H15.8974L15.3846 13.3459H13.2111ZM10.51 25.8398H18.085L17.7448 24.2666H10.8496L10.51 25.8398ZM9.92349 9.55121C9.35456 8.68734 9.0539 7.67446 9.05935 6.64009C9.06481 5.60572 9.37614 4.59607 9.95416 3.73825L9.1654 3.20625C8.48171 4.21976 8.11343 5.41301 8.10699 6.63554C8.10055 7.85806 8.45624 9.05513 9.12921 10.0758L9.92349 9.55121ZM20.4888 6.66797C20.49 5.45881 20.1362 4.27591 19.4715 3.26587L18.6753 3.79045C19.2427 4.65394 19.5423 5.66589 19.5363 6.69913C19.5304 7.73237 19.2192 8.74079 18.6418 9.59768L19.4305 10.1297C20.122 9.1078 20.4907 7.90182 20.4888 6.66797ZM6.73149 11.655C5.80908 10.2531 5.29352 8.62289 5.2421 6.94554C5.19069 5.26819 5.60544 3.60944 6.44025 2.15368L5.61454 1.67749C4.69162 3.2866 4.23315 5.12017 4.29012 6.97428C4.34708 8.8284 4.91725 10.6304 5.93721 12.1798L6.73149 11.655Z" fill="currentColor"/>
    </svg>`;

export const towerIconSvg2 = `<svg fill="currentColor" version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
	 width="29" height="29" viewBox="0 0 29 29" xml:space="preserve">
<g>
	<path d="M28.928,17.914l-1.293-1.293c4.226-4.227,4.225-11.103-0.002-15.328L28.928,0C33.867,4.938,33.867,12.976,28.928,17.914z
		 M26.69,2.236l-1.293,1.293c2.991,2.993,2.991,7.863,0,10.854l1.293,1.295C30.396,11.973,30.396,5.941,26.69,2.236z M24.382,4.543
		l-1.293,1.293c1.722,1.722,1.722,4.521,0,6.24l1.294,1.293C26.816,10.938,26.816,6.978,24.382,4.543z M6.072,17.914l1.293-1.293
		C3.139,12.395,3.14,5.519,7.367,1.293L6.072,0C1.132,4.938,1.132,12.976,6.072,17.914z M8.308,15.679l1.294-1.295
		c-2.992-2.991-2.992-7.861,0-10.854L8.308,2.236C4.602,5.941,4.602,11.973,8.308,15.679z M10.616,13.371l1.294-1.295
		c-1.72-1.72-1.72-4.519,0.001-6.238l-1.294-1.293C8.183,6.978,8.183,10.938,10.616,13.371z M12.811,22.23l4.479-3.951l-2.885-2.545
		l-1.958,6.176L12.811,22.23z M16.085,10.438l1.205-1.062l-0.679-0.6L16.085,10.438z M12.811,23.23l-1.086,0.959L8.297,35h0.134
		l8.859-7.814L12.811,23.23z M15.645,11.828l-0.991,3.125l3.203,2.826l3.246-2.863l-0.859-2.935l-2.387-2.106L15.645,11.828z
		 M19.85,10.632l-0.585-2l-0.841,0.741L19.85,10.632z M17.857,8.873l1.175-1.035l-1.019-3.481L16.86,7.995L17.857,8.873z
		 M17.857,27.684L9.565,35h3.077c0.151-2.641,2.319-4.738,4.996-4.738c2.677,0,4.845,2.1,4.997,4.738h3.515L17.857,27.684z
		 M23.757,23.984l-0.854-0.754l-4.479,3.953l8.449,7.455L23.757,23.984z M18.424,18.279l4.479,3.951l0.271-0.238l-1.839-6.281
		L18.424,18.279z M22.335,22.73l-4.479-3.951l-4.479,3.951l4.479,3.953L22.335,22.73z"
    fill="currentColor"
    />
</g>
</svg>`;
