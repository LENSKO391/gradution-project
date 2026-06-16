import { render, screen } from '@testing-library/react';
import App from './App';

test('renders encryption system auth screen', () => {
  render(<App />);
  expect(screen.getByText(/encryption system/i)).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /login/i }).length).toBeGreaterThan(0);
});
