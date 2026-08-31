// Register only the trace families used by QbD Studio. Importing the complete
// plotly.js distribution adds many unused maps, finance and specialist traces.
import Plotly from 'plotly.js/lib/core';
import scatter from 'plotly.js/lib/scatter';
import bar from 'plotly.js/lib/bar';
import contour from 'plotly.js/lib/contour';
import surface from 'plotly.js/lib/surface';
import scatter3d from 'plotly.js/lib/scatter3d';

Plotly.register([scatter, bar, contour, surface, scatter3d]);

export default Plotly;
