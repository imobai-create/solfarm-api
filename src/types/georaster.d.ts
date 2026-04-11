declare module 'georaster' {
  interface GeoRaster {
    data: number[][][]
    xmin: number
    xmax: number
    ymin: number
    ymax: number
    pixelWidth: number
    pixelHeight: number
    noDataValue: number | null
    width: number
    height: number
    numberOfRasters: number
    projection: number
  }

  function parseGeoraster(input: string | ArrayBuffer | File): Promise<GeoRaster>

  export default parseGeoraster
}
