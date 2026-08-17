declare module "@3d-dice/dice-box-threejs" {
  export type DiceBoxColorset = {
    name?: string;
    foreground?: string;
    background?: string;
    outline?: string;
    texture?: string;
    material?: string;
  };

  export type DiceBoxOptions = {
    assetPath?: string;
    framerate?: number;
    sounds?: boolean;
    volume?: number;
    color_spotlight?: number;
    shadows?: boolean;
    theme_surface?: string;
    sound_dieMaterial?: string;
    theme_customColorset?: DiceBoxColorset;
    theme_colorset?: string;
    theme_texture?: string;
    theme_material?: string;
    gravity_multiplier?: number;
    light_intensity?: number;
    baseScale?: number;
    strength?: number;
    onRollComplete?: (result: unknown) => void;
  };

  export default class DiceBox {
    constructor(selector: string, options?: DiceBoxOptions);
    initialize(): Promise<void>;
    roll(notation: string): Promise<unknown>;
    clearDice(): void;
    scene: {
      add: (object: unknown) => void;
      remove: (object: unknown) => void;
    };
    camera: {
      position: { set: (x: number, y: number, z: number) => void };
      lookAt: (x: number, y: number, z: number) => void;
    };
    cameraHeight: { far: number; medium: number; close: number; max: number };
    world: {
      gravity: { set: (x: number, y: number, z: number) => void };
    };
    light: {
      intensity: number;
      position: { set: (x: number, y: number, z: number) => void; x: number; y: number; z: number };
      color?: { set: (hex: number) => void };
      clone: () => DiceBox["light"] & { intensity: number };
    };
    light_amb: { intensity: number };
    renderer: {
      dispose: () => void;
      domElement: HTMLCanvasElement;
    };
    desk: { receiveShadow: boolean };
    diceList: Array<{ position: { x: number; y: number; z: number } }>;
  }
}
