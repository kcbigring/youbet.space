import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodSchema } from "zod";
import { badRequest } from "./errors";

/// Forwards rejected promises to the error middleware, which Express 4 does not
/// do on its own.
export const asyncHandler =
  (handler: (req: any, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

export function parseBody<T>(schema: ZodSchema<T>, req: Request): T {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    throw badRequest("Invalid request body", result.error.flatten().fieldErrors);
  }
  return result.data;
}

export function parseQuery<T>(schema: ZodSchema<T>, req: Request): T {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    throw badRequest("Invalid query parameters", result.error.flatten().fieldErrors);
  }
  return result.data;
}
