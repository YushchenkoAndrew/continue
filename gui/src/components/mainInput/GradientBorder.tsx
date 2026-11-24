import styled, { keyframes } from "styled-components";
import { varWithFallback } from "../../styles/theme";

// While the model is working the frame breathes between the neutral border and the theme's
// focus colour, instead of cycling through a rainbow gradient.
const pulse = keyframes`
  0%, 100% {
    background-color: var(--chat-border);
  }
  50% {
    background-color: ${varWithFallback("border-focus")};
  }
`;

export const GradientBorder = styled.div<{
  borderRadius?: string;
  borderColor?: string;
  loading: 0 | 1;
}>`
  border-radius: ${(props) => props.borderRadius || "0"};
  padding: 1px;
  box-sizing: border-box; /* width: 100% must include the 1px border padding */
  background-color: ${(props) => props.borderColor || "var(--chat-border)"};
  animation: ${(props) => (props.loading ? pulse : "none")} 2.4s ease-in-out
    infinite;
  width: 100%;
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-top: ${(props) => (props.loading ? "8px" : "")};

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;
