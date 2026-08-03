import EventEmitter from 'events';

const createEventBus = () => {
  const bus = new EventEmitter();
  bus.setMaxListeners(30);
  return bus;
};

const eventBus = createEventBus();
export default eventBus;
