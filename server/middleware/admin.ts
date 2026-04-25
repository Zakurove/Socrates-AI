import type { Request, Response, NextFunction } from "express";

/**
 * Gate handlers behind the `users.isAdmin` flag. Assumes `requireAuth`
 * has already run upstream — so `req.user` is populated.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ message: "Admins only" });
  }
  next();
}
