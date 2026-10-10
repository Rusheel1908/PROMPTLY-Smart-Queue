import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { LANDING } from '../config';

const B = LANDING.render.bloom;

/** Bloom on everything brighter than the threshold: tokens, gate rings and the kiosk screen use HDR colours (>1) to glow. */
export function Effects() {
  return (
    <EffectComposer multisampling={4}>
      <Bloom mipmapBlur intensity={B.intensity} luminanceThreshold={B.threshold} luminanceSmoothing={B.smoothing} />
    </EffectComposer>
  );
}
