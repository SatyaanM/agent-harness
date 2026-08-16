import type { Response } from "express";
import { z } from "zod";

export const IdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "must be a simple identifier");

export const RelativePathSchema = z
  .string()
  .max(2_048)
  .refine((value) => !value.includes("\0"), "must not contain a null byte")
  .refine((value) => !/^(?:[A-Za-z]:|[/\\])/u.test(value), "must be relative")
  .refine(
    (value) => !value.replaceAll("\\", "/").split("/").includes(".."),
    "must not traverse outside its root",
  );

export function validateRequest<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
  res: Response,
): z.output<TSchema> | null {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  res.status(400).json({
    error: {
      code: "invalid_request",
      message: "Request validation failed",
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join(".") || "request",
        message: issue.message,
      })),
    },
  });
  return null;
}
