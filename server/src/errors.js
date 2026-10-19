/**
 * Problem-details style API errors. Every failure surfaced to a client is an
 * `ApiError` so the global error handler can serialise it consistently:
 *
 *   { "error": { "code": "snake_case_code", "message": "Human readable" } }
 */
export class ApiError extends Error {
  constructor(status, code, message, extra = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (code, message) => new ApiError(400, code, message);
export const unauthorized = (code, message) => new ApiError(401, code, message);
export const forbidden = (code, message) => new ApiError(403, code, message);
export const notFound = (code = 'not_found', message = 'Not found') =>
  new ApiError(404, code, message);
export const conflict = (code, message) => new ApiError(409, code, message);
export const payloadTooLarge = (code, message) => new ApiError(413, code, message);
export const locked = (message = 'Resource is locked') => new ApiError(423, 'locked', message);

/** 404 for anything that must not be disclosed across users. */
export const nodeNotFound = () => notFound('node_not_found', 'Item not found');

function sendError(res, status, code, message, extra) {
  if (res.headersSent) return;
  const body = { error: { code, message } };
  if (extra) Object.assign(body.error, extra);
  res.status(status).json(body);
}

/**
 * Terminal Express error handler. Known errors map to the documented contract,
 * unknown ones are logged and reported generically (no internals leaked).
 */
export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) return;

  if (err instanceof ApiError) {
    return sendError(res, err.status, err.code, err.message, err.extra);
  }

  // Validation errors raised by the name/username/password helpers.
  if (err && err.name === 'ValidationError') {
    return sendError(res, 400, err.code ?? 'validation_error', err.message);
  }

  // multer / busboy upload errors
  if (err && err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return sendError(res, 413, 'upload_too_large', 'The uploaded file is too large');
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return sendError(res, 400, 'invalid_upload', err.message);
    }
    return sendError(res, 400, 'invalid_upload', err.message);
  }

  // body-parser errors
  if (err && err.type === 'entity.too.large') {
    return sendError(res, 413, 'payload_too_large', 'Request body is too large');
  }
  if (err && err.type === 'entity.parse.failed') {
    return sendError(res, 400, 'invalid_json', 'Request body is not valid JSON');
  }

  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  return sendError(res, 500, 'internal_error', 'Internal server error');
}

/** Wrap an async route handler so rejected promises reach `errorHandler`. */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
