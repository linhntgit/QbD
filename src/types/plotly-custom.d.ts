declare module 'plotly.js/lib/core' {
  const Plotly: typeof import('plotly.js-dist-min');
  export default Plotly;
}

declare module 'plotly.js/lib/scatter' {
  const trace: any;
  export default trace;
}

declare module 'plotly.js/lib/bar' {
  const trace: any;
  export default trace;
}

declare module 'plotly.js/lib/contour' {
  const trace: any;
  export default trace;
}

declare module 'plotly.js/lib/surface' {
  const trace: any;
  export default trace;
}

declare module 'plotly.js/lib/scatter3d' {
  const trace: any;
  export default trace;
}
