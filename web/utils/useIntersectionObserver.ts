export function useIntersectionObserver(target: Ref<HTMLElement | null>) {
  const isVisible = ref(false);

  watchEffect((onInvalidate) => {
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        isVisible.value = entry.isIntersecting;
      },
      {
        root: null, // Observe in the viewport
        threshold: 1, // Trigger when the target is fully visible
      }
    );

    if (target.value) {
      observer.observe(target.value);
    }

    onInvalidate(() => {
      if (observer && target.value) {
        observer.unobserve(target.value);
      }
    });
  });

  return { isVisible };
}
