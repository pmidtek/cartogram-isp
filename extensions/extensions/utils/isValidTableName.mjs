const isValidTableName = (tableName) => {
  return /^[a-zA-Z_][a-zA-Z0-9_]{1,49}$/.test(tableName);
};

export default isValidTableName;
