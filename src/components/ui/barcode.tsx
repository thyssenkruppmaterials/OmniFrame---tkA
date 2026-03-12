import React, { useRef, useEffect } from 'react'

interface BarcodeProps {
  value: string
  width?: number
  height?: number
  fontSize?: number
  displayValue?: boolean
  className?: string
}

/**
 * Barcode component - placeholder implementation
 * TODO: Integrate with JsBarcode library when available
 */
export const Barcode: React.FC<BarcodeProps> = ({
  value,
  width = 2,
  height = 100,
  fontSize = 14,
  displayValue = true,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size
    canvas.width = Math.max(200, value.length * 10)
    canvas.height = height + (displayValue ? fontSize + 10 : 0)

    // Clear canvas
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Draw placeholder barcode pattern
    ctx.fillStyle = 'black'

    // Create a simple barcode pattern
    const barWidth = width
    const totalBars = 50
    let x = 10

    for (let i = 0; i < totalBars; i++) {
      // Alternate between thick and thin bars based on a simple pattern
      const isThick =
        i % 3 === 0 || value.charCodeAt(i % value.length) % 2 === 0
      const currentWidth = isThick ? barWidth * 2 : barWidth

      // Draw bar (alternate between black bars and white spaces)
      if (i % 2 === 0) {
        ctx.fillRect(x, 10, currentWidth, height - 20)
      }

      x += currentWidth + 1
    }

    // Draw value text if requested
    if (displayValue) {
      ctx.fillStyle = 'black'
      ctx.font = `${fontSize}px monospace`
      ctx.textAlign = 'center'
      ctx.fillText(value, canvas.width / 2, height + fontSize)
    }
  }, [value, width, height, fontSize, displayValue])

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <canvas
        ref={canvasRef}
        className='border border-gray-300 bg-white'
        style={{ maxWidth: '100%' }}
      />
      <p className='mt-1 text-xs text-gray-500'>Barcode: {value}</p>
    </div>
  )
}

/**
 * Enhanced Barcode component that will use JsBarcode when available
 * For now, this is just a wrapper around the placeholder implementation
 */
export const EnhancedBarcode: React.FC<BarcodeProps> = (props) => {
  // TODO: Implement with JsBarcode
  // import JsBarcode from 'jsbarcode';
  //
  // const barcodeRef = useRef<HTMLCanvasElement>(null);
  //
  // useEffect(() => {
  //   if (barcodeRef.current) {
  //     JsBarcode(barcodeRef.current, props.value, {
  //       format: "CODE128",
  //       width: props.width || 2,
  //       height: props.height || 100,
  //       displayValue: props.displayValue ?? true,
  //       fontSize: props.fontSize || 14,
  //     });
  //   }
  // }, [props.value, props.width, props.height, props.fontSize, props.displayValue]);
  //
  // return <canvas ref={barcodeRef} className={props.className} />;

  // For now, use the placeholder implementation
  return <Barcode {...props} />
}

export default Barcode
