// SPCalc browser entry point for the pinned, checksum-verified official tables.
import { forgetOfficialBounds, rememberOfficialBounds } from '../shared/plugins/officialBounds.js';
let data = null;
export const getData = () => data;
export const setData = (value) => { data = value; rememberOfficialBounds(value); };
export const resetData = () => { data = null; forgetOfficialBounds(); };
