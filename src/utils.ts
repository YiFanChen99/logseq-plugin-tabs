/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PageEntity } from "@logseq/libs/dist/LSPlugin";
import React, { useMemo, useState } from "react";
import isEqual from "fast-deep-equal";
import { useHoverDirty, useMountedState } from "react-use";
import { schemaVersion } from "../package.json";
import { ITabInfo } from "./types";
import { inheritCustomCSSSetting } from "./settings";

export const useAppVisible = () => {
  const [visible, setVisible] = useState(logseq.isMainUIVisible);
  const isMounted = useMountedState();
  React.useEffect(() => {
    const eventName = "ui:visible:changed";
    const handler = async ({ visible }: { visible: boolean }) => {
      if (isMounted()) {
        setVisible(visible);
      }
    };
    logseq.on(eventName, handler);
    return () => {
      logseq.off(eventName, handler);
    };
  }, [isMounted]);
  return visible;
};

export const useSidebarVisible = () => {
  const [visible, setVisible] = useState(false);
  const isMounted = useMountedState();
  React.useEffect(() => {
    logseq.App.onSidebarVisibleChanged(({ visible }) => {
      if (isMounted()) {
        setVisible(visible);
      }
    });
  }, [isMounted]);
  return visible;
};

export const useThemeMode = () => {
  const isMounted = useMountedState();
  const [mode, setMode] = React.useState<"dark" | "light">("light");
  React.useEffect(() => {
    setMode(
      (top!.document
        .querySelector("html")
        ?.getAttribute("data-theme") as typeof mode) ??
        (matchMedia("prefers-color-scheme: dark").matches ? "dark" : "light")
    );
    return logseq.App.onThemeModeChanged((s) => {
      if (isMounted()) {
        setMode(s.mode);
      }
    });
  }, [isMounted]);

  return mode;
};

export async function getSourcePage(
  pageName?: string | null
): Promise<PageEntity | null> {
  if (!pageName) {
    return null;
  }
  const page = await logseq.Editor.getPage(pageName);

  // If the page contains alias and it has no property alias ...
  // @ts-expect-error
  if (page && page.alias?.length > 0 && !(page.properties?.alias.length > 0)) {
    // @ts-expect-error
    const pageId = page.alias[0]?.id;
    if (pageId) {
      return await logseq.Editor.getPage(pageId);
    }
  }
  return page;
}

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function getKeyId(graph: string) {
  return "logseq-plugin-tabs:" + schemaVersion + "/" + graph;
}

const readFromLocalStorage = (graph: string): ITabInfo[] | null => {
  const str = localStorage.getItem(getKeyId(graph));
  if (str) {
    try {
      return JSON.parse(str);
    } catch {
      // no ops
    }
  }
  return null;
};

const persistToLocalStorage = (tabs: ITabInfo[], graph: string) => {
  localStorage.setItem(getKeyId(graph), JSON.stringify(tabs));
};

function useCurrentGraph() {
  const [graph, setGraph] = useState<string | null>(null);
  const reset = async () => {
    const g = await logseq.App.getCurrentGraph();
    setGraph(g?.path ?? null);
  };
  React.useEffect(() => {
    reset();
    return logseq.App.onCurrentGraphChanged(() => {
      reset();
    });
  }, []);
  return graph;
}

export function useStoreTabs() {
  const [tabs, setTabs] = React.useState<ITabInfo[]>([]);
  const currentGraph = useCurrentGraph();

  React.useEffect(() => {
    if (currentGraph) {
      const tabs = readFromLocalStorage(currentGraph);
      setTabs(tabs ?? []);
    }
  }, [currentGraph]);

  const userSetTabs = (newTabs: ITabInfo[]) => {
    if (currentGraph && !isEqual(tabs, newTabs)) {
      persistToLocalStorage(newTabs, currentGraph);
      return setTabs(newTabs);
    }
  };

  return [tabs, userSetTabs] as const;
}

export function debounce<T extends (...args: any[]) => any>(fn: T, ms: number) {
  let timeout: number | null = null;
  return (...args: any[]) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = window.setTimeout(() => {
      fn(...args);
      timeout = null;
    }, ms);
  };
}

export function useDebounceFn<T extends (...args: any[]) => any>(
  callback: T,
  timeout = 300
) {
  const safeCallback = useEventCallback(callback);
  return useMemo(
    () => debounce(safeCallback, timeout),
    [safeCallback, timeout]
  );
}

interface RouteState {
  template: string;
  path: string;
}

function useRouteState() {
  const [state, setState] = React.useState<RouteState | null>(
    // @ts-expect-error getStateFromStore sames not working properly
    top?.logseq.api.get_state_from_store("route-match")
  );

  React.useEffect(() => {
    return logseq.App.onRouteChanged(setState);
  }, []);

  return state;
}

function useSettingValue<V>(key: string) {
  const [value, setValue] = React.useState<V>(logseq.settings?.[key]);
  React.useEffect(() => {
    return logseq.onSettingsChanged(() => {
      setValue(logseq.settings?.[key]);
    });
  });
  return value;
}

export function useCustomCSS() {
  const enabled = useSettingValue(inheritCustomCSSSetting.key);
  React.useEffect(() => {
    const rootHead = top?.document.head;
    if (rootHead && enabled) {
      const applyCustomCSS = () => {
        let customCSSLink = document.getElementById(
          "logseq-custom-theme-id"
        ) as HTMLLinkElement;
        if (!customCSSLink) {
          customCSSLink = document.createElement("link");
          customCSSLink.id = "logseq-custom-theme-id";
          customCSSLink.rel = "stylesheet";
          customCSSLink.media = "all";
          document.head.append(customCSSLink);
        }
        const content = top?.document.querySelector<HTMLLinkElement>(
          "#logseq-custom-theme-id"
        )?.href;
        if (content) {
          customCSSLink.href = content;
        }
      };

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const addedNode of mutation.addedNodes) {
            if (
              addedNode.nodeName === "LINK" &&
              (addedNode as HTMLLinkElement).id === "logseq-custom-theme-id"
            ) {
              applyCustomCSS();
              break;
            }
          }
        }
      });
      observer.observe(rootHead, {
        childList: true,
      });
      applyCustomCSS();
      return () => {
        observer.disconnect();
      };
    }
    if (!enabled) {
      document.getElementById("logseq-custom-theme-id")?.remove();
    }
  });
}

export function useAdaptMainUIStyle(show: boolean, tabsWidth?: number | null) {
  const route = useRouteState();
  useCustomCSS();
  const shouldShow =
    show &&
    (!route?.template ||
      ["/", "/all-journals", "/page/:name", "/file/:path"].includes(
        route?.template
      ));
  const docRef = React.useRef(document.documentElement);
  const isHovering = useHoverDirty(docRef);
  React.useEffect(() => {
    logseq.provideStyle({
      key: "tabs--top-padding",
      style: `
      #main-content-container {
        padding-top: ${shouldShow ? "64px" : ""};
      }`,
    });

    logseq.showMainUI({ autoFocus: false });
    const headerEl = top!.document.querySelector(
      "#head.cp__header"
    )! as HTMLElement;

    const mainContainer = top!.document.querySelector(
      "#main-content-container"
    ) as HTMLElement;

    if (!mainContainer) {
      return;
    }

    const listener = () => {
      const { left: leftOffset, width } = mainContainer.getBoundingClientRect();
      const maxWidth = width - 10;
      logseq.setMainUIInlineStyle({
        zIndex: 9,
        userSelect: "none",
        position: "fixed",
        left: `${leftOffset}px`,
        top: `${headerEl.offsetHeight + 2}px`,
        height: shouldShow ? "28px" : "0px",
        width: isHovering ? "100%" : tabsWidth + "px", // 10 is the width of the scrollbar
        maxWidth: maxWidth + "px",
        // @ts-ignore
        WebkitAppRegion: "drag",
      });
    };
    listener();
    const ob = new ResizeObserver(listener);
    ob.observe(mainContainer);
    return () => {
      ob.disconnect();
    };
  }, [shouldShow, tabsWidth, isHovering]);
}

export const isMac = () => {
  return navigator.userAgent.includes("Mac");
};

export function useEventCallback<T extends (...args: any[]) => any>(fn: T): T {
  const ref: any = React.useRef();

  // we copy a ref to the callback scoped to the current state/props on each render
  React.useLayoutEffect(() => {
    ref.current = fn;
  });

  return React.useCallback(
    (...args: any[]) => ref.current.apply(void 0, args),
    []
  ) as T;
}

export const useScrollWidth = <T extends HTMLElement>(
  ref: React.RefObject<T>
) => {
  const [scrollWidth, setScrollWidth] = React.useState<number>();
  React.useEffect(() => {
    const update = () => setScrollWidth(ref.current?.scrollWidth || 0);
    const mo = new MutationObserver(() => {
      // Run multiple times to take animation into account, hacky...
      update();
      setTimeout(update, 100);
      setTimeout(update, 200);
      setTimeout(update, 300);
    });
    if (ref.current) {
      setScrollWidth(ref.current.scrollWidth || 0);
      mo.observe(ref.current, {
        childList: true,
        subtree: true,
        attributes: true,
      });
    }
    return () => mo.disconnect();
  }, [ref]);
  return scrollWidth;
};

export const mainContainerScroll = (scrollOptions: ScrollToOptions) => {
  top?.document.querySelector("#main-container")?.scrollTo(scrollOptions);
};

export const isBlock = (t: ITabInfo) => {
  return Boolean(t.page);
};

// Makes sure the user will not lose focus (editing state) when previewing a link
export const usePreventFocus = () => {
  const restoreFocus = useDebounceFn(
    useEventCallback(() => {
      if (window.document.hasFocus()) {
        (top as any).focus();
        logseq.Editor.restoreEditingCursor();
      }
    }),
    10
  );
  React.useEffect(() => {
    let timer = 0;
    timer = setInterval(restoreFocus, 1000);
    window.addEventListener("focus", restoreFocus);
    return () => {
      window.removeEventListener("focus", restoreFocus);
      clearInterval(timer);
    };
  });
};
