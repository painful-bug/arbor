/** Structured application error carried across layers to the HTTP boundary. */
export class AppError extends Error {
	constructor(
		message: string,
		/** HTTP status the boundary should respond with. */ readonly status: number = 500,
		/** Stable machine-readable code, SCREAMING_SNAKE. */ readonly code: string = "INTERNAL",
	) {
		super(message);
		this.name = "AppError";
	}
}

/** 400 Bad Request factory. */
export const badRequest = (m: string) => new AppError(m, 400, "BAD_REQUEST");
/** 404 Not Found factory. */
export const notFound = (m: string) => new AppError(m, 404, "NOT_FOUND");
