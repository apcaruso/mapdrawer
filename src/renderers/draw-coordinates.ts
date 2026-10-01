import { geoEquirectangular, geoGraticule, geoPath, select } from "d3";
import { viewport } from "@/components/viewport";
import { ensureEl, rn, round } from "@/utils";

const STEPS = [0.5, 1, 2, 5, 10, 15, 30]; // possible distances between the graticule lines, in degrees

let drawnKey = ""; // what the drawn grid was built for: while it holds, a pan only moves the label rows

export function drawCoordinates(): void {
  const coordinatesEl = ensureEl<SVGGElement>("coordinates");
  const coordinates = select(coordinatesEl);

  const { lonT, lonW, lonE, latN, latS } = options.map.geography.coordinates;
  const goal = lonT / viewport.scale / 10;
  const step = STEPS.reduce((prev, curr) => (Math.abs(curr - goal) < Math.abs(prev - goal) ? curr : prev));
  const desiredSize = styles.coordinates.options.fontSize;

  // labels are placed at the top left corner of the screen, in map coordinates
  const point = new DOMPoint(viewport.scale + desiredSize + 2, viewport.scale + desiredSize / 2);
  const corner = point.matrixTransform(ensureEl<SVGGElement>("viewbox").getScreenCTM()!.inverse());

  const { width, height } = options.map.graph;
  const key = [viewport.scale, step, desiredSize, lonW, lonE, latN, latS, width, height].join("|");
  const latitudeLabels = coordinatesEl.querySelector("#latitudeLabels");
  const longitudeLabels = coordinatesEl.querySelector("#longitudeLabels");
  if (key === drawnKey && latitudeLabels && longitudeLabels) {
    latitudeLabels.setAttribute("transform", `translate(${rn(corner.x, 2)} 0)`);
    longitudeLabels.setAttribute("transform", `translate(0 ${rn(corner.y, 2)})`);
    return;
  }

  coordinates.selectAll("*").remove(); // the grid and the label size depend on the zoom level
  coordinates.attr("font-size", Math.max(rn(desiredSize / viewport.scale ** 0.8, 2), 0.1));

  const graticule = geoGraticule()
    .extent([
      [lonW, latN],
      [lonE + 0.1, latS + 0.1]
    ])
    .stepMajor([400, 400])
    .stepMinor([step, step]);
  const projection = geoEquirectangular().fitSize([width, height], graticule());

  // a latitude label sits on its line at the left edge, a longitude label at the top: each row moves as one
  const labels = graticule.lines().map(line => {
    const isLatitude = line.coordinates[0][1] === line.coordinates[1][1];
    const [lon, lat] = line.coordinates[0];
    const position = projection([lon, lat])!;
    const [x, y] = isLatitude ? [0, rn(position[1], 2)] : [rn(position[0], 2), 0];

    const value = isLatitude ? lat : lon;
    let text = "";
    if (Number.isInteger(value) && value) {
      if (isLatitude) text = lat < 0 ? `${-lat}°S` : `${lat}°N`;
      else text = lon < 0 ? `${-lon}°W` : `${lon}°E`;
    } else if (!value) text = String(value);

    return { x, y, text, isLatitude };
  });

  coordinates
    .append("g")
    .attr("id", "coordinateGrid")
    .append("path")
    .attr("d", round(geoPath(projection)(graticule())!))
    .attr("vector-effect", "non-scaling-stroke");

  const labelGroups = coordinates.append("g").attr("id", "coordinateLabels");
  for (const isLatitude of [true, false]) {
    labelGroups
      .append("g")
      .attr("id", isLatitude ? "latitudeLabels" : "longitudeLabels")
      .attr("transform", isLatitude ? `translate(${rn(corner.x, 2)} 0)` : `translate(0 ${rn(corner.y, 2)})`)
      .selectAll("text")
      .data(labels.filter(label => label.isLatitude === isLatitude))
      .enter()
      .append("text")
      .attr("text-rendering", "optimizeSpeed")
      .attr("x", label => label.x)
      .attr("y", label => label.y)
      .text(label => label.text);
  }
  drawnKey = key;
}
