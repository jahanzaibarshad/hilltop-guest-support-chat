export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error.code === 50)
    return res
      .status(503)
      .json({ message: 'Database search timed out. Narrow your filters or try again.' });
  if (error.code === 11000) return res.status(409).json({ message: 'This record already exists.' });
  if (error.type === 'entity.parse.failed')
    return res.status(400).json({ message: 'Invalid JSON body.' });
  if (error.type === 'entity.too.large')
    return res.status(413).json({ message: 'Request body is too large.' });
  if (error.type === 'encoding.unsupported')
    return res.status(415).json({ message: 'Compressed request bodies are not supported.' });
  if (error.name === 'ValidationError')
    return res.status(400).json({ message: 'Invalid record data.' });
  const status = error instanceof HttpError ? error.status : 500;
  if (status === 500) console.error('Request failed:', error.name);
  res
    .status(status)
    .json({ message: status === 500 ? 'An unexpected error occurred.' : error.message });
}
