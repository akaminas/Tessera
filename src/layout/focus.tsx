import { createContext, useContext, useState, type ReactNode } from 'react';

/** Focus mode hides navigation, notification badges and secondary chrome. */
const Ctx = createContext<{ focus: boolean; setFocus(v: boolean): void }>({ focus: false, setFocus: () => {} });

export function FocusProvider({ children }: { children: ReactNode }) {
  const [focus, setFocusState] = useState(() => {
    try {
      return sessionStorage.getItem('tessera.focus') === '1';
    } catch {
      return false;
    }
  });
  const setFocus = (v: boolean) => {
    setFocusState(v);
    try {
      sessionStorage.setItem('tessera.focus', v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
  return <Ctx.Provider value={{ focus, setFocus }}>{children}</Ctx.Provider>;
}

export function useFocusMode() {
  return useContext(Ctx);
}
