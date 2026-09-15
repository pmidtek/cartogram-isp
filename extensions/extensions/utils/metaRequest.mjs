const getRequestMeta = (req) => {
  const ua = req.headers["user-agent"];
  return {
    ip: req.accountability?.ip || req.socket?.remoteAddress || null,
    userAgent: typeof ua === "string" ? ua.slice(0, 512) : null,
    origin: req.headers.origin || req.headers.referer || null,
  };
};

export default getRequestMeta;
