// Created and developed by Jai Singh
// Native three r183 post pipeline (RenderPipeline + TSL bloom) — works under
// WebGPU and its WebGL2 fallback alike. Selective bloom: materials opt in
// via their mrtNode bloomIntensity; everything else stays crisp. A subtle
// screen-space vignette finishes the command-center grade.
import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { float, mrt, output, pass, screenUV } from 'three/tsl'
import * as THREE from 'three/webgpu'
import { logger } from '@/lib/utils/logger'

interface RenderPipelineLike {
  outputNode: unknown
  render: () => void
  dispose?: () => void
}

export function PostFX() {
  const { gl, scene, camera } = useThree()

  const pipeline = useMemo<RenderPipelineLike | null>(() => {
    try {
      const three = THREE as unknown as Record<string, unknown>
      // r183 renamed PostProcessing → RenderPipeline (identical API)
      const Ctor = (three.RenderPipeline ?? three.PostProcessing) as
        | (new (renderer: unknown) => RenderPipelineLike)
        | undefined
      if (
        !Ctor ||
        !(gl as unknown as { isWebGPURenderer?: boolean }).isWebGPURenderer
      ) {
        return null
      }
      const pp = new Ctor(gl)
      const scenePass = pass(scene, camera)
      scenePass.setMRT(mrt({ output, bloomIntensity: float(0) }))
      const scenePassColor = scenePass.getTextureNode('output')
      const bloomMask = scenePass.getTextureNode('bloomIntensity')
      const bloomPass = bloom(scenePassColor.mul(bloomMask), 0.6, 0.25, 0)
      const vignette = screenUV
        .distance(0.5)
        .remap(0.4, 1.05, 1, 0.62)
        .clamp(0.62, 1)
      pp.outputNode = scenePassColor.add(bloomPass).mul(vignette).renderOutput()
      return pp
    } catch (error) {
      logger.warn(
        'Supply chain map: post pipeline unavailable, rendering without bloom',
        error
      )
      return null
    }
  }, [gl, scene, camera])

  useEffect(() => () => pipeline?.dispose?.(), [pipeline])

  // Priority > 0 takes over R3F's render loop; without a pipeline we render
  // nothing here and R3F's default pass continues untouched.
  useFrame(
    () => {
      pipeline?.render()
    },
    pipeline ? 1 : 0
  )

  return null
}
