import { AppRegistry } from "react-native";
import { name as appName } from "./app.json";
import ArgusHostApp from "./src/ArgusHostApp";

AppRegistry.registerComponent(appName, () => ArgusHostApp);
