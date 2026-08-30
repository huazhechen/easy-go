/** SGF date property value in the YYYY-MM-DD form used by `DT`. */
export const formatSgfDate = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/** SGF coordinates use 'aa' for top-left 0,0, so a move is two letters. */
export const coordinateToSgf = (x: number, y: number): string => {
  const aCode = 'a'.charCodeAt(0);
  const xChar = String.fromCharCode(aCode + x);
  const yChar = String.fromCharCode(aCode + y);
  return xChar + yChar;
};
