const ReactTestRenderer = require('react-test-renderer');

function createRoot(options) {
  let instance;

  return {
    render(element) {
      instance = ReactTestRenderer.create(element, options);
    },
    get container() {
      return instance && instance.root;
    },
    unmount() {
      if (instance) {
        instance.unmount();
        instance = null;
      }
    },
  };
}

module.exports = {
  createRoot,
  act: ReactTestRenderer.act,
};
