declare module '@rnmapbox/maps' {
  import { ReactNode, Component } from 'react';
  
  export class MapView extends Component<any> {}
  export class Camera extends Component<any> {
    setCamera(config: any): void;
  }
  export class ShapeSource extends Component<any> {}
  export class SymbolLayer extends Component<any> {}
  export class CircleLayer extends Component<any> {}
  export class LineLayer extends Component<any> {}
  export class HeatmapLayer extends Component<any> {}
  export class PointAnnotation extends Component<any> {}
  export class Images extends Component<any> {}
  export class LocationPuck extends Component<any> {}

  export const StyleURL: any;
  export const InterpolationMode: any;
  
  const Mapbox: any;
  export default Mapbox;
  export function setAccessToken(token: string): void;
}
