import React from 'react';
import styles from './index.module.scss';
import InitSteps from './InitSteps';

const Init: React.FC = () => {
  return (
    <div className={styles.initContainer}>
      <InitSteps />
    </div>
  );
};

export default Init;
