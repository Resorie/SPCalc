// Calculator adapter, 2026-10-29. Replaces the upstream filesystem loader only.
// The upstream simulation and combat content are unmodified.
let data = null;
export const getData = () => data;
export const setData = (value) => { data = value; };
export const resetData = () => { data = null; };
