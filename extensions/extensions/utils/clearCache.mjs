const clearCache = async (logger, env) => {
  try {
    const baseUrl = env.PUBLIC_URL.replace(/\/+$/, "");
    const response = await fetch(
      `${baseUrl}/utils/cache/clear?access_token=${env.ADMIN_TOKEN}`,
      {
        method: "POST",
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    logger.info("Clear cache success : " + response.status);
  } catch (error) {
    logger.error("Clear cache error : " + error);
  }
};

export default clearCache;
