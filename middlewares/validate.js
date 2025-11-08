export function validate(schema) {
  return (req, _res, next) => {
    const parsed = schema.safeParse({
      body: req.body,
      params: req.params,
      query: req.query,
    });
    if (!parsed.success) {
      const e = new Error("Validation failed");
      e.status = 400;
      e.code = "VALIDATION_ERROR";
      e.details = parsed.error.issues;
      return next(e);
    }
    req.valid = parsed.data;
    next();
  };
}
