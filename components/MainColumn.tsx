import type { ReactNode } from 'react';
import { mainColumnClassName } from './main-column-model';

type MainColumnProps = {
  children: ReactNode;
};

/** Stable content column boundary for page navigation and feature sections. */
export default function MainColumn({ children }: MainColumnProps) {
  return <section className={mainColumnClassName()}>{children}</section>;
}
