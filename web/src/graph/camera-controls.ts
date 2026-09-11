import type Sigma from "sigma";
import type { MouseCoords, WheelCoords } from "sigma/types";

export type CameraControls = { destroy(): void };

/**
 * Keeps camera input independent of graph contents. Sigma's native captor does
 * not move an empty graph, so both viewer pages use this controller instead.
 */
export function createCameraControls(
  sigma: Sigma,
  onInput: () => void,
): CameraControls {
  let drag: { x: number; y: number } | null = null;
  const captor = sigma.getMouseCaptor();
  const onWheel = (event: WheelCoords) => {
    event.preventSigmaDefault();
    event.original.preventDefault();
    event.original.stopPropagation();
    const camera = sigma.getCamera();
    const state = camera.getState();
    camera.setState({ ratio: Math.max(0.01, Math.min(10, state.ratio * Math.exp(-event.delta * 0.12))) });
    onInput();
  };
  const onMouseDown = (event: MouseCoords) => {
    drag = { x: event.x, y: event.y };
    onInput();
  };
  const onMouseMove = (event: MouseCoords) => {
    if (!drag) return;
    if (event.x === drag.x && event.y === drag.y) return;
    event.preventSigmaDefault();
    const previous = sigma.viewportToFramedGraph(drag);
    const current = sigma.viewportToFramedGraph(event);
    const state = sigma.getCamera().getState();
    sigma.getCamera().setState({
      x: state.x + previous.x - current.x,
      y: state.y + previous.y - current.y,
    });
    drag = { x: event.x, y: event.y };
    onInput();
  };
  const onMouseUp = () => { drag = null; };

  captor.on("wheel", onWheel);
  captor.on("mousedown", onMouseDown);
  captor.on("mousemovebody", onMouseMove);
  captor.on("mouseup", onMouseUp);

  return {
    destroy() {
      captor.off("wheel", onWheel);
      captor.off("mousedown", onMouseDown);
      captor.off("mousemovebody", onMouseMove);
      captor.off("mouseup", onMouseUp);
    },
  };
}
