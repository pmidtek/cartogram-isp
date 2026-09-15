import { ServiceUnavailableError, ForbiddenError } from "@directus/errors";

export default async (req, res, next) => {
  const { accountability } = req;
  if (!accountability.user) {
    return next(new ForbiddenError());
  }
  next();
};
