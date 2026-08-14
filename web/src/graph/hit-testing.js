// Sigma reads the WebGL picking buffer (gl.readPixels) on every mousemove,
// which stalls the main thread. A canvas render stays valid for a whole
// animation frame, so deduplicate lookups per ~frame bucket: at most one
// readPixels per frame instead of ~2 per mouse event.

const FRAME_BUCKET_MS = 17;

export function dedupeNodeHitTest(sigma) {
	const rawGetNodeAtPosition = sigma.getNodeAtPosition.bind(sigma);
	let pixelReadBucket = -1;
	const cache = new Map();
	sigma.getNodeAtPosition = (position) => {
		const bucket = (performance.now() / FRAME_BUCKET_MS) | 0;
		if (bucket !== pixelReadBucket) {
			pixelReadBucket = bucket;
			cache.clear();
		}
		const key = `${position.x},${position.y}`;
		if (cache.has(key)) return cache.get(key);
		const result = rawGetNodeAtPosition(position);
		cache.set(key, result);
		return result;
	};
}