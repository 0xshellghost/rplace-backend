const parseDimension = (value: string | undefined, fallback: number): number => {
	const dimension = Number(value ?? fallback);
	return Number.isInteger(dimension) && dimension > 0 ? dimension : fallback;
};

export const CANVAS_WIDTH = parseDimension(process.env.CANVAS_WIDTH, 1000);
export const CANVAS_HEIGHT = parseDimension(process.env.CANVAS_HEIGHT, 600);
export const CANVAS_BYTES = (CANVAS_WIDTH * CANVAS_HEIGHT) / 2;