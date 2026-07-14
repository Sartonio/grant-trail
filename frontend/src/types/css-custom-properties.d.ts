// Allow CSS custom properties (`--foo`) in React `style` objects.
// Needed since @types/react joined the program: csstype's Properties has no
// index signature, so inline styles like `{ '--accent-color': x }` (used by
// components) would fail typecheck otherwise. This is the augmentation
// documented by csstype/@types/react for design-token style props.
import "csstype";

declare module "csstype" {
  interface Properties {
    [index: `--${string}`]: string | number | undefined;
  }
}
