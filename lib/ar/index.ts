/**
 * lib/ar - future AR extension point.
 *
 * Spec section 16: V0.1 ships an interface and a null implementation only. No AR
 * code is written, no WebXR dependency is pulled in, and nothing in the V0.1
 * runtime path calls into this module.
 *
 * The interface is defined now because retrofitting a provider seam after the UI
 * is written is materially harder than declaring it up front. The shape below is
 * the contract a future `LocationBasedWebXRProvider` (built on top of the
 * Apache-2.0 `cs-util-com/location-based-webxr` ideas, re-implemented) would
 * satisfy:
 *
 *   GPS -> Scene -> ARAnchor -> 3D Object
 *
 * Type-only imports from `../location` and `../game` keep this module free of
 * runtime coupling - importing `lib/ar` cannot pull Leaflet, React or the device
 * GPS into a bundle that does not need them.
 */

import type { Coordinate } from "../location/types";
import type { Scene } from "../game/types";

/** Resolved placement for a scene's AR content. */
export interface ARAnchor {
  sceneId: string;
  /** Entity id the renderer should draw. */
  entityId: string;
  position: Coordinate;
  /** Metres above ground. */
  altitudeOffset: number;
  /** Radians, applied in the renderer's own convention. */
  heading: number;
  scale: number;
  /** Opaque provider-specific payload. */
  metadata?: Record<string, unknown>;
}

export interface ARCapabilities {
  /** Does this environment support AR at all? */
  supported: boolean;
  /** Immersive-AR session available (WebXR `immersive-ar`). */
  immersiveSession: boolean;
  /** World tracking (6DoF) available. */
  worldTracking: boolean;
  /** Plane/ground detection available. */
  planeDetection: boolean;
  /** Reason for lack of support, for player-facing copy. */
  reason?: string;
}

/**
 * The provider seam. A future implementation registers itself here and the rest
 * of the app talks only to this interface.
 */
export interface ARProvider {
  readonly id: string;
  readonly label: string;

  /** Probe the environment. Must never throw. */
  getCapabilities(): Promise<ARCapabilities>;

  /**
   * Resolve a scene into a placeable anchor.
   * Returns `null` when the scene has no AR content or no anchor can be found.
   */
  resolveAnchor(scene: Scene, playerPosition: Coordinate | null): Promise<ARAnchor | null>;

  /** Begin rendering. V0.1 implementation rejects with a clear message. */
  start(scene: Scene, playerPosition: Coordinate | null): Promise<void>;

  /** Tear down and release the camera and GPU resources. */
  stop(): Promise<void>;

  /** True while a session is live. */
  isRunning(): boolean;
}

/**
 * Null implementation.
 *
 * Everything answers "not available" honestly rather than pretending to work,
 * so the UI can show a clear "AR 将在后续版本提供" state without a feature flag.
 */
export class NullARProvider implements ARProvider {
  readonly id = "null";
  readonly label = "AR 未启用（占位实现）";

  async getCapabilities(): Promise<ARCapabilities> {
    return {
      supported: false,
      immersiveSession: false,
      worldTracking: false,
      planeDetection: false,
      reason: "V0.1 不包含 AR 功能。此接口为 V0.2 的 WebXR 集成预留。",
    };
  }

  async resolveAnchor(): Promise<ARAnchor | null> {
    return null;
  }

  async start(): Promise<void> {
    throw new Error("AR_PROVIDER_UNAVAILABLE: V0.1 未实现 AR 渲染，请使用地图模式。");
  }

  async stop(): Promise<void> {
    /* nothing to tear down */
  }

  isRunning(): boolean {
    return false;
  }
}

/** The active provider. Swappable without touching any UI component. */
let activeProvider: ARProvider = new NullARProvider();

export function getARProvider(): ARProvider {
  return activeProvider;
}

export function setARProvider(provider: ARProvider): void {
  activeProvider = provider;
}

/**
 * Map a scene's optional `ar` block onto anchor defaults, without contacting a
 * provider. Useful for validating content packs ahead of a future AR build.
 */
export function describeSceneARContent(scene: Scene): {
  hasARContent: boolean;
  anchorType: string;
  modelUrl: string | null;
} {
  const ar = scene.ar;
  return {
    hasARContent: Boolean(ar?.modelUrl),
    anchorType: ar?.anchorType ?? "ground",
    modelUrl: ar?.modelUrl ?? null,
  };
}
