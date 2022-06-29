import ForgeUI, {
    Fragment,
    Table,
    Cell,
    Head,
    Row,
    render,
    Macro,
    MacroConfig,
    Text,
    TextField,
    useConfig,
    useState,
    Image,
    Heading

} from "@forge/ui";

import api, {route} from "@forge/api";

function Velocity(name, commitments, completed, completeDate, startDate, endDate) {
    this.commitments = commitments;
    this.completed = completed;
    this.name = name;
    this.completeDate = completeDate;
    this.startDate = startDate;
    this.endDate = endDate;
}

const defaultConfig = {
    sprintId: null,
};


const fetchProjects = async () => {

    const response = await api.asUser().requestJira(route`/rest/api/3/project`, {
        headers: {
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        return "Error to get Jira projet list" + response;
    }
    return await response.json();
};

function fillCompleted(issues, sprintIdToVelocityMap) {

    issues.forEach(issue => {
        if (issue.fields.status.name === 'Done') {
            if (issue.fields.customfield_10020) {
                const sprints = issue.fields.customfield_10020;
                const lastSprint = sprints[sprints.length - 1];
                const velocity = sprintIdToVelocityMap.get(lastSprint.id);

                if (!velocity) {
                    return;
                }

                velocity.completed += issue.fields.customfield_10016;
            }
        }
    });
}

function fillCommitments(issues, sprintIdToVelocityMap) {
    for (const issue of issues) {
        const sprints = issue.fields.customfield_10020;
        sprints.forEach(sprint => {
            const velocity = sprintIdToVelocityMap.get(sprint.id);

            if (!velocity) {
                return;
            }

            const actionsForSprint = getActionsForSprint(sprint, issue.changelog.histories);

            if (!isIssueAddedAfterSprintStart(sprint.id, actionsForSprint)) {
                velocity.commitments += issue.fields.customfield_10016;//getStoryPointsBySprint(issue, sprint);
            }
        });
    }
}


function getStoryPointsBySprint(issue, sprint) { //REFACTORING: change spring to date interval for reusing
    const estimationChangesSortedByDate = issue.changelog.histories
        .filter(history =>
            extractDateFromTimeStamp(history.created) >= extractDateFromTimeStamp(issue.fields.created) &&
            extractDateFromTimeStamp(history.created) <= extractDateFromTimeStamp(sprint.startDate))
        .filter(history => history.items[0].fieldId === "customfield_10016")
        .sort((history1, history2) => extractDateFromTimeStamp(history1.created) >= extractDateFromTimeStamp(history2.created));

    if (estimationChangesSortedByDate.length > 0) return Number(estimationChangesSortedByDate[0].items[0].toString);

    return 0;
}

function isIssueAddedAfterSprintStart(sprintId, actions) {
    for (const action of actions) {
        if (action.items[0].field === "Sprint" &&
            (!action.items[0].from || !action.items[0].from.includes(sprintId)) &&
            action.items[0].to.includes(sprintId)
        ) {
            return true;
        }
    }
    return false;
}

function getActionsForSprint(sprint, histories) {
    return histories.filter(history =>
        extractDateFromTimeStamp(history.created) >= extractDateFromTimeStamp(sprint.startDate) &&
        extractDateFromTimeStamp(history.created) <= extractDateFromTimeStamp(sprint.completeDate)
    );
}

function extractDateFromTimeStamp(date) {
    return new Date(date);
}

function extractSprintIdToVelocityMap(previousSprints) {

    const sprintIdToSprintDetailsMap = new Map;

    previousSprints.forEach(sprint => sprintIdToSprintDetailsMap.set(
            sprint.id,
            new Velocity(
                sprint.name,
                0,
                0,
                sprint.completeDate,
                sprint.startDate,
                sprint.endDate)
        )
    );


    return sprintIdToSprintDetailsMap;
}

const getSprintInfo = async (sprintId) => {
    const response = await api.asUser().requestJira(route`/rest/agile/1.0/sprint/${sprintId}`);
    if(!response.ok) return null;
    return response.json();
};

function getPreviousSprintsBySprintId(target) {
    const allSprints = useState(getAllSprints(target.originBoardId));

    if (!allSprints) return [];

    return allSprints
        .filter(x => x)
        .flatMap(allSprintsResponse => allSprintsResponse.values)
        .filter(x => x)
        .filter(sprint => sprint.startDate)
        .filter(sprint => extractDateFromTimeStamp(sprint.startDate) <= extractDateFromTimeStamp(target.startDate))
        .sort((sprint1, sprint2) => sprint1.startDate - sprint2.startDate)
        .reverse()
        .slice(0, 5)
        .reverse();
}

const getAllSprints = async (boardId) => {
    const response = await api.asApp().requestJira(route`/rest/agile/1.0/board/${boardId}/sprint?state=closed`);
    if(response.ok) return response.json();
    return [];
}

function getIssues(sprint, previousSprints) {
    const sprintIds = previousSprints.map(sprint => sprint.id);
    return issuesBySprintIds(sprintIds, sprint);
}

const issuesBySprintIds = async (sprintIds, projectKey) => {
    console.log(route`/rest/api/3/search?jql=sprint in closedSprints() and sprint in (${sprintIds})&expand=changelog`);
    const response = await api.asApp().requestJira(route`/rest/api/3/search?jql=sprint in closedSprints() and sprint in (${sprintIds})&expand=changelog`);

    const result = await response.json();

    if (!result ||
        (Object.keys(result).length === 0 && result.constructor === Object) ||
        result === "") {
        return [];
    }
    return result.issues;
}


const App = () => {

    const config = useConfig() || defaultConfig;

    const sprintId = config.sprintId;

    if (!sprintId) {
        return <Text>enter the spring id to render report</Text>;
    }
    const [sprintInfo] = useState(getSprintInfo(sprintId));

    if (!sprintInfo) {
        return <Text>sprint with entered id doesn't exist</Text>;
    }

    const previousSprints = getPreviousSprintsBySprintId(sprintInfo);



    const sprintsIssues = getIssues(sprintInfo, previousSprints);

    const [issues] = useState(sprintsIssues);

    const sprintIdToVelocityMap = extractSprintIdToVelocityMap(previousSprints);

    fillCompleted(issues, sprintIdToVelocityMap);

    fillCommitments(issues, sprintIdToVelocityMap);

    const details = Array.from(sprintIdToVelocityMap, ([key, value]) => ({key, value}));

    const limitedDetails = details.sort((a, b) => a.value.completeDate - b.value.completeDate);


    const names = JSON.stringify(limitedDetails.map((detail, i) => {
        if(i === 0) { // add names only for honest index
            return  " " ;
        } else {
            return detail.value.name;
        }
    }));
    const commitments = JSON.stringify(limitedDetails.map(detail => detail.value.commitments));
    const completed = JSON.stringify(limitedDetails.map(detail => detail.value.completed));
    const predictable = JSON.stringify(limitedDetails
        .map((detail => (detail.value.completed / detail.value.commitments) * 100)));

    const velocityChartURL = "https://quickchart.io/chart?bkg=white&c={type:%27bar%27,data:{labels:"
        .concat(names)
        .concat(",")
        .concat("datasets:[{")
        .concat("borderColor: %27rgba(255, 138, 0, 1)%27,")
        .concat("backgroundColor: %27rgba(255, 138, 0, 1)%27,")
        .concat("label:%27commitments%27,data:")
        .concat(commitments)
        .concat("},")
        .concat("{")
        .concat("borderColor: %27rgba(0, 130, 202, 1)%27,")
        .concat("backgroundColor: %27rgba(0, 130, 202, 1)%27,")
        .concat("label:%27completed%27,data:")
        .concat(completed)
        .concat("}]},")
        .concat("options:{scales:{xAxes:[{ticks:{beginAtZero:false,fontSize:10}},],},}}");


    const areaChartURL = "https://quickchart.io/chart?bkg=white&c={type:%27line%27,data:{labels:"
        .concat(names)
        .concat(",")
        .concat("datasets:[{")
        .concat("backgroundColor: %27rgba(0, 130, 202, 1)%27,")
        .concat("borderColor: %27rgba(0, 130, 202, 1)%27,")
        .concat("fill: false,")
        .concat("label:%27Predictability %25 vs iterations%27,data:")
        .concat(predictable)
        .concat("}]},")
        .concat("options:{scales:{xAxes:[{ticks:{beginAtZero:false,fontSize:10}},],},}}");

    console.log("VELOCITY CHART:           " + JSON.stringify(velocityChartURL, null, "   " ));
    console.log("AREA CHART:           " + JSON.stringify(areaChartURL, null, "   " ));

    return (
        <Fragment>
            <Heading size="large">Velocity chart</Heading>
            <Image
                src={velocityChartURL}
                alt="progress"
            />
            <Heading size="large">Predictability chart</Heading>
            <Image
                src={areaChartURL}
                alt="progress"
            />

            <Table>
                <Head>
                    <Cell>
                        <Text>Sprint name</Text>
                    </Cell>
                    <Cell>
                        <Text>Sprint id</Text>
                    </Cell>
                    <Cell>
                        <Text>commitments</Text>
                    </Cell>
                    <Cell>
                        <Text>completed</Text>
                    </Cell>
                </Head>
                {
                    limitedDetails.map(velocity => (
                        <Row>
                            <Cell>
                                <Text>{velocity.value.name}</Text>
                            </Cell>
                            <Cell>
                                <Text>{velocity.key}</Text>
                            </Cell>
                            <Cell>
                                <Text>{velocity.value.commitments}</Text>
                            </Cell>
                            <Cell>
                                <Text>{velocity.value.completed}</Text>
                            </Cell>
                        </Row>
                    ))}
            </Table>
        </Fragment>);
}

/*

export const run = render(
    <Macro app={<App/>}
    />
);

const Config = () => {
    const [projects] = useState(fetchProjects);

    return (
        <MacroConfig>
            <Select label="Project" name="projectKey">
                {projects.map((project) => {
                    return (
                        <Option
                            label={`${project.name} (${project.key})`}
                            value={project.key}
                        />
                    );
                })}
            </Select>
        </MacroConfig>
    );
};

export const config = render(<Config/>);*/
export const run = render(
    <Macro app={<App/>}
    />
);

// Function that defines the configuration UI
const Config = () => {
    return (
        <MacroConfig>
            <TextField name="sprintId" label="sprint id" defaultValue={defaultConfig.sprintId}/>
        </MacroConfig>
    );
};

export const config = render(<Config/>);