import styled from "styled-components";
import { varWithFallback } from "../../styles/theme";

// While the model is working, the frame of the message being processed is highlighted in the
// theme's focus colour. It is steady (no blinking or moving) and does not change the box
// size, so nothing shifts when a run starts or ends.
const WORKING_BORDER = varWithFallback("border-focus");

export const GradientBorder = styled.div<{
  borderRadius?: string;
  borderColor?: string;
  loading: 0 | 1;
}>`
  border-radius: ${(props) => props.borderRadius || "0"};
  padding: 1px;
  box-sizing: border-box; /* width: 100% must include the 1px border padding */
  background-color: ${(props) =>
    props.loading ? WORKING_BORDER : props.borderColor || "var(--chat-border)"};
  transition: background-color 0.4s ease;
  width: 100%;
  display: flex;
  flex-direction: row;
  align-items: center;
`;
