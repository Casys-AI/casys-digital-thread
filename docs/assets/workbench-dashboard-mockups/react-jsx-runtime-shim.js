const R = window.React;
export const Fragment = R.Fragment;
export function jsx(type, props, key){ const {children, ...rest} = props || {}; return R.createElement(type, key!==undefined?{...rest,key}:rest, children); }
export const jsxs = jsx;
export const jsxDEV = jsx;
